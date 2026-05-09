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
use std::collections::BTreeMap;

use crate::manifest::Manifest;
#[cfg(feature = "native-audio")]
use crate::manifest::SegmentManifest;

#[cfg(feature = "native-audio")]
const SAMPLE_RATE: u32 = 48_000;
#[cfg(feature = "native-audio")]
const OPUS_FRAME_SAMPLES: usize = 960;
#[cfg(feature = "native-audio")]
const FINAL_MIX_MIC_GAIN: f32 = 2.1;
#[cfg(feature = "native-audio")]
const FINAL_MIX_SYSTEM_GAIN: f32 = 0.55;

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

pub fn build_mixed_opus(_recording_dir: &Path, manifest: &Manifest, output: &Path) -> anyhow::Result<bool> {
    #[cfg(feature = "native-audio")]
    {
        build_native_mixed_opus(_recording_dir, manifest, output)
    }

    #[cfg(not(feature = "native-audio"))]
    {
        build_mock_mixed_opus(manifest, output)
    }
}

#[cfg(feature = "native-audio")]
fn wasapi_result<T>(result: Result<T, Box<dyn std::error::Error>>) -> anyhow::Result<T> {
    result.map_err(|error| anyhow::anyhow!("{error}"))
}

#[cfg(feature = "native-audio")]
pub(crate) struct OpusOggWriter {
    file: fs::File,
    encoder: opus::Encoder,
    serial: u32,
    sequence: u32,
    granule_position: u64,
    channels: u16,
}

#[cfg(feature = "native-audio")]
impl OpusOggWriter {
    pub(crate) fn create(path: &Path, channels: u16) -> anyhow::Result<Self> {
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

    pub(crate) fn write_frame(&mut self, pcm: &[f32]) -> anyhow::Result<()> {
        let mut packet = [0_u8; 1500];
        let len = self.encoder.encode_float(pcm, &mut packet)?;
        self.granule_position += OPUS_FRAME_SAMPLES as u64;
        self.write_page(&[packet[..len].to_vec()], 0x00, self.granule_position)
    }

    pub(crate) fn finish(mut self) -> anyhow::Result<()> {
        self.write_page(&[], 0x04, self.granule_position)?;
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
fn build_native_mixed_opus(recording_dir: &Path, manifest: &Manifest, output: &Path) -> anyhow::Result<bool> {
    let mic_segments = segments_by_index(manifest, "mic");
    let system_segments = segments_by_index(manifest, "system");
    if mic_segments.is_empty() && system_segments.is_empty() {
        return Ok(false);
    }

    let mut writer = OpusOggWriter::create(output, 2)?;
    let first = mic_segments
        .keys()
        .chain(system_segments.keys())
        .min()
        .copied()
        .unwrap_or(1);
    let last = mic_segments
        .keys()
        .chain(system_segments.keys())
        .max()
        .copied()
        .unwrap_or(first);

    for index in first..=last {
        let mic_pcm = match mic_segments.get(&index) {
            Some(segment) => decode_segment(recording_dir, segment, 1)?,
            None => Vec::new(),
        };
        let system_pcm = match system_segments.get(&index) {
            Some(segment) => decode_segment(recording_dir, segment, 2)?,
            None => Vec::new(),
        };
        let mixed = mix_to_stereo(&mic_pcm, &system_pcm);
        write_stereo_frames(&mut writer, &mixed)?;
    }

    writer.finish()?;
    Ok(true)
}

#[cfg(feature = "native-audio")]
fn segments_by_index<'a>(manifest: &'a Manifest, track: &str) -> BTreeMap<u32, &'a SegmentManifest> {
    manifest
        .segments
        .iter()
        .filter(|segment| segment.track == track)
        .map(|segment| (segment.index, segment))
        .collect()
}

#[cfg(feature = "native-audio")]
fn decode_segment(recording_dir: &Path, segment: &SegmentManifest, channels: u16) -> anyhow::Result<Vec<f32>> {
    let packets = read_ogg_packets(&recording_dir.join(&segment.path))?;
    let opus_channels = if channels == 1 {
        opus::Channels::Mono
    } else {
        opus::Channels::Stereo
    };
    let mut decoder = opus::Decoder::new(SAMPLE_RATE, opus_channels)?;
    let mut pcm = Vec::new();
    let mut buffer = vec![0.0_f32; 5760 * channels as usize];

    for packet in packets {
        if packet.is_empty() || packet.starts_with(b"OpusHead") || packet.starts_with(b"OpusTags") {
            continue;
        }
        let frames = decoder.decode_float(&packet, &mut buffer, false)?;
        pcm.extend_from_slice(&buffer[..frames * channels as usize]);
    }

    Ok(pcm)
}

#[cfg(feature = "native-audio")]
fn read_ogg_packets(path: &Path) -> anyhow::Result<Vec<Vec<u8>>> {
    let bytes = fs::read(path)?;
    let mut packets = Vec::new();
    let mut current = Vec::new();
    let mut offset = 0_usize;

    while offset + 27 <= bytes.len() {
        if &bytes[offset..offset + 4] != b"OggS" {
            bail!("pagina Ogg invalida en {}", path.display());
        }

        let segments = bytes[offset + 26] as usize;
        let lacing_start = offset + 27;
        let body_start = lacing_start + segments;
        if body_start > bytes.len() {
            bail!("pagina Ogg truncada en {}", path.display());
        }

        let body_len = bytes[lacing_start..body_start]
            .iter()
            .map(|value| *value as usize)
            .sum::<usize>();
        let body_end = body_start + body_len;
        if body_end > bytes.len() {
            bail!("cuerpo Ogg truncado en {}", path.display());
        }

        let mut body_offset = body_start;
        for lace in &bytes[lacing_start..body_start] {
            let lace_len = *lace as usize;
            current.extend_from_slice(&bytes[body_offset..body_offset + lace_len]);
            body_offset += lace_len;
            if lace_len < 255 {
                packets.push(std::mem::take(&mut current));
            }
        }

        offset = body_end;
    }

    Ok(packets)
}

#[cfg(feature = "native-audio")]
fn mix_to_stereo(mic_pcm: &[f32], system_pcm: &[f32]) -> Vec<f32> {
    let mic_frames = mic_pcm.len();
    let system_frames = system_pcm.len() / 2;
    let frames = mic_frames.max(system_frames);
    let mut mixed = Vec::with_capacity(frames * 2);

    for frame in 0..frames {
        let mic = mic_pcm.get(frame).copied().unwrap_or_default() * FINAL_MIX_MIC_GAIN;
        let left = system_pcm.get(frame * 2).copied().unwrap_or_default() * FINAL_MIX_SYSTEM_GAIN;
        let right = system_pcm.get(frame * 2 + 1).copied().unwrap_or_default() * FINAL_MIX_SYSTEM_GAIN;
        mixed.push(soft_limit(left + mic));
        mixed.push(soft_limit(right + mic));
    }

    mixed
}

#[cfg(feature = "native-audio")]
fn soft_limit(sample: f32) -> f32 {
    if sample.abs() <= 0.95 {
        sample
    } else {
        (sample * 0.82).tanh()
    }
}

#[cfg(feature = "native-audio")]
fn write_stereo_frames(writer: &mut OpusOggWriter, samples: &[f32]) -> anyhow::Result<()> {
    let frame_len = OPUS_FRAME_SAMPLES * 2;
    let mut offset = 0_usize;

    while offset < samples.len() {
        let end = (offset + frame_len).min(samples.len());
        if end - offset == frame_len {
            writer.write_frame(&samples[offset..end])?;
        } else {
            let mut padded = vec![0.0_f32; frame_len];
            padded[..end - offset].copy_from_slice(&samples[offset..end]);
            writer.write_frame(&padded)?;
        }
        offset = end;
    }

    Ok(())
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

#[cfg(not(feature = "native-audio"))]
fn build_mock_mixed_opus(manifest: &Manifest, output: &Path) -> anyhow::Result<bool> {
    if manifest.segments.is_empty() {
        return Ok(false);
    }
    let mut file = fs::File::create(output)?;
    file.write_all(b"meetings-recorder mock mixed opus placeholder\n")?;
    file.write_all(manifest.recording_id.as_bytes())?;
    file.sync_all()?;
    Ok(true)
}
