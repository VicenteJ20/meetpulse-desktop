use std::{
    fs,
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::bail;

#[cfg(feature = "native-audio")]
const SAMPLE_RATE: u32 = 48_000;
#[cfg(feature = "native-audio")]
const OPUS_FRAME_SAMPLES: usize = 960;

pub fn record_segment_to_opus(
    track: &str,
    path: &Path,
    duration: Duration,
    _stop_flag: Arc<AtomicBool>,
    _rms_meter: Arc<AtomicU32>,
) -> anyhow::Result<()> {
    #[cfg(feature = "native-audio")]
    {
        record_native_segment_to_opus(track, path, duration, _stop_flag, _rms_meter)
    }

    #[cfg(not(feature = "native-audio"))]
    {
        write_mock_opus(track, path, duration, _rms_meter)
    }
}

#[cfg(feature = "native-audio")]
fn record_native_segment_to_opus(
    track: &str,
    path: &Path,
    duration: Duration,
    stop_flag: Arc<AtomicBool>,
    rms_meter: Arc<AtomicU32>,
) -> anyhow::Result<()> {
    match track {
        "mic" => record_wasapi_segment(track, path, duration, stop_flag, rms_meter, 1, false),
        "system" => record_wasapi_segment(track, path, duration, stop_flag, rms_meter, 2, true),
        _ => bail!("track desconocido: {track}"),
    }
}

#[cfg(feature = "native-audio")]
fn record_wasapi_segment(
    track: &str,
    path: &Path,
    duration: Duration,
    stop_flag: Arc<AtomicBool>,
    rms_meter: Arc<AtomicU32>,
    channels: u16,
    loopback: bool,
) -> anyhow::Result<()> {
    use std::collections::VecDeque;
    use std::time::Instant;
    use wasapi::{get_default_device, initialize_mta, Direction, SampleType, ShareMode, WaveFormat};

    let _ = initialize_mta().ok();

    let direction = if loopback {
        Direction::Render
    } else {
        Direction::Capture
    };
    let device = wasapi_result(get_default_device(&direction))?;
    let mut audio_client = wasapi_result(device.get_iaudioclient())?;
    let desired_format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE as usize, channels as usize, None);
    let blockalign = desired_format.get_blockalign() as usize;
    let (_, min_time) = wasapi_result(audio_client.get_periods())?;

    wasapi_result(audio_client.initialize_client(
        &desired_format,
        min_time,
        if loopback { &Direction::Capture } else { &Direction::Capture },
        &ShareMode::Shared,
        true,
    ))?;
    let event = wasapi_result(audio_client.set_get_eventhandle())?;
    let capture_client = wasapi_result(audio_client.get_audiocaptureclient())?;
    let mut queue = VecDeque::with_capacity(blockalign * SAMPLE_RATE as usize * channels as usize);
    let mut encoder = OpusOggWriter::create(path, channels)?;
    let mut pending = Vec::<f32>::with_capacity(OPUS_FRAME_SAMPLES * channels as usize * 2);
    let started = Instant::now();

    wasapi_result(audio_client.start_stream())?;
    while started.elapsed() < duration && !stop_flag.load(Ordering::SeqCst) {
        let _ = event.wait_for_event(250);
        let flags = wasapi_result(capture_client.read_from_device_to_deque(&mut queue))?;
        while queue.len() >= blockalign {
            if flags.silent {
                for _ in 0..channels {
                    pending.push(0.0);
                }
                for _ in 0..blockalign {
                    let _ = queue.pop_front();
                }
            } else {
                let mut frame = [0_u8; 4];
                for _ in 0..channels {
                    for byte in &mut frame {
                        *byte = queue.pop_front().unwrap_or_default();
                    }
                    pending.push(f32::from_le_bytes(frame).clamp(-1.0, 1.0));
                }
            }

            let needed = OPUS_FRAME_SAMPLES * channels as usize;
            if pending.len() >= needed {
                rms_meter.store(f32_to_bits(calculate_rms(&pending[..needed])), Ordering::Relaxed);
                encoder.write_frame(&pending[..needed])?;
                pending.drain(..needed);
            }
        }
    }
    wasapi_result(audio_client.stop_stream())?;

    let needed = OPUS_FRAME_SAMPLES * channels as usize;
    if !pending.is_empty() {
        pending.resize(needed, 0.0);
        rms_meter.store(f32_to_bits(calculate_rms(&pending[..needed])), Ordering::Relaxed);
        encoder.write_frame(&pending[..needed])?;
    }
    encoder.finish()?;
    rms_meter.store(0, Ordering::Relaxed);
    tracing::debug!(track, "native audio segment written");
    Ok(())
}

#[cfg(feature = "native-audio")]
fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum = samples.iter().map(|sample| sample * sample).sum::<f32>();
    (sum / samples.len() as f32).sqrt().min(1.0)
}

pub fn f32_to_bits(value: f32) -> u32 {
    value.to_bits()
}

pub fn f32_from_bits(value: u32) -> f32 {
    f32::from_bits(value).clamp(0.0, 1.0)
}

#[cfg(feature = "native-audio")]
fn wasapi_result<T>(result: Result<T, Box<dyn std::error::Error>>) -> anyhow::Result<T> {
    result.map_err(|error| anyhow::anyhow!("{error}"))
}

#[cfg(feature = "native-audio")]
struct OpusOggWriter {
    file: fs::File,
    encoder: opus::Encoder,
    serial: u32,
    sequence: u32,
    granule_position: u64,
    channels: u16,
}

#[cfg(feature = "native-audio")]
impl OpusOggWriter {
    fn create(path: &Path, channels: u16) -> anyhow::Result<Self> {
        let file = fs::File::create(path)?;
        let opus_channels = if channels == 1 {
            opus::Channels::Mono
        } else {
            opus::Channels::Stereo
        };
        let mut writer = Self {
            file,
            encoder: opus::Encoder::new(SAMPLE_RATE, opus_channels, opus::Application::Audio)?,
            serial: rand::random(),
            sequence: 0,
            granule_position: 0,
            channels,
        };
        writer.encoder.set_bitrate(opus::Bitrate::Bits(if channels == 1 { 48_000 } else { 96_000 }))?;
        writer.write_headers()?;
        Ok(writer)
    }

    fn write_headers(&mut self) -> anyhow::Result<()> {
        let mut head = Vec::with_capacity(19);
        head.extend_from_slice(b"OpusHead");
        head.push(1);
        head.push(self.channels as u8);
        head.extend_from_slice(&312_u16.to_le_bytes());
        head.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
        head.extend_from_slice(&0_i16.to_le_bytes());
        head.push(0);

        let vendor = b"meetings-recorder";
        let mut tags = Vec::new();
        tags.extend_from_slice(b"OpusTags");
        tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        tags.extend_from_slice(vendor);
        tags.extend_from_slice(&0_u32.to_le_bytes());

        self.write_page(&[head], 0x02, 0)?;
        self.write_page(&[tags], 0x00, 0)?;
        Ok(())
    }

    fn write_frame(&mut self, pcm: &[f32]) -> anyhow::Result<()> {
        let mut packet = [0_u8; 1500];
        let len = self.encoder.encode_float(pcm, &mut packet)?;
        self.granule_position += OPUS_FRAME_SAMPLES as u64;
        self.write_page(&[packet[..len].to_vec()], 0x00, self.granule_position)
    }

    fn finish(mut self) -> anyhow::Result<()> {
        self.write_page(&[Vec::new()], 0x04, self.granule_position)?;
        self.file.sync_all()?;
        Ok(())
    }

    fn write_page(&mut self, packets: &[Vec<u8>], header_type: u8, granule_position: u64) -> anyhow::Result<()> {
        let mut lacing = Vec::new();
        let mut body = Vec::new();
        for packet in packets {
            let mut remaining = packet.len();
            let mut offset = 0;
            while remaining >= 255 {
                lacing.push(255);
                body.extend_from_slice(&packet[offset..offset + 255]);
                offset += 255;
                remaining -= 255;
            }
            lacing.push(remaining as u8);
            body.extend_from_slice(&packet[offset..]);
        }

        let mut page = Vec::with_capacity(27 + lacing.len() + body.len());
        page.extend_from_slice(b"OggS");
        page.push(0);
        page.push(header_type);
        page.extend_from_slice(&granule_position.to_le_bytes());
        page.extend_from_slice(&self.serial.to_le_bytes());
        page.extend_from_slice(&self.sequence.to_le_bytes());
        page.extend_from_slice(&0_u32.to_le_bytes());
        page.push(lacing.len() as u8);
        page.extend_from_slice(&lacing);
        page.extend_from_slice(&body);

        let checksum = ogg_crc(&page);
        page[22..26].copy_from_slice(&checksum.to_le_bytes());
        self.file.write_all(&page)?;
        self.sequence += 1;
        Ok(())
    }
}

#[cfg(feature = "native-audio")]
fn ogg_crc(bytes: &[u8]) -> u32 {
    let mut crc = 0_u32;
    for byte in bytes {
        crc ^= (*byte as u32) << 24;
        for _ in 0..8 {
            crc = if (crc & 0x8000_0000) != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(not(feature = "native-audio"))]
fn write_mock_opus(track: &str, path: &Path, duration: Duration, rms_meter: Arc<AtomicU32>) -> anyhow::Result<()> {
    if track != "mic" && track != "system" {
        bail!("track desconocido: {track}");
    }
    let mut file = fs::File::create(path)?;
    file.write_all(b"meetings-recorder mock opus placeholder\n")?;
    file.write_all(track.as_bytes())?;
    file.write_all(b"\n")?;
    file.write_all(&duration.as_millis().to_le_bytes())?;
    file.sync_all()?;
    rms_meter.store(f32_to_bits(if track == "mic" { 0.22 } else { 0.16 }), Ordering::Relaxed);
    Ok(())
}
