use std::{
    fs::File,
    io::{Seek, SeekFrom, Write},
    path::Path,
};

pub fn write_silence_wav(path: &Path, sample_rate: u32, channels: u16, duration_ms: u64) -> anyhow::Result<u64> {
    let bytes_per_sample = 2_u16;
    let samples_per_channel = ((sample_rate as u64) * duration_ms) / 1000;
    let data_bytes = samples_per_channel * channels as u64 * bytes_per_sample as u64;

    let mut file = File::create(path)?;
    write_header(&mut file, sample_rate, channels, data_bytes as u32)?;

    let chunk = [0_u8; 8192];
    let mut remaining = data_bytes;
    while remaining > 0 {
        let size = remaining.min(chunk.len() as u64) as usize;
        file.write_all(&chunk[..size])?;
        remaining -= size as u64;
    }

    file.sync_all()?;
    Ok(44 + data_bytes)
}

fn write_header(file: &mut File, sample_rate: u32, channels: u16, data_bytes: u32) -> anyhow::Result<()> {
    let bits_per_sample = 16_u16;
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;

    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36_u32.saturating_add(data_bytes)).to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16_u32.to_le_bytes())?;
    file.write_all(&1_u16.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;
    Ok(())
}
