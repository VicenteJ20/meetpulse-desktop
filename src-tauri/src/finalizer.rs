use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::manifest::Manifest;
use crate::wav_writer::write_silence_wav;

pub struct FinalAudioBuilder;

impl FinalAudioBuilder {
    pub fn build(_recording_dir: &Path, manifest: &Manifest) -> anyhow::Result<Option<PathBuf>> {
        let recording_dir = _recording_dir;
        let final_dir = recording_dir.join("final");
        fs::create_dir_all(&final_dir)?;

        let duration_ms = manifest
            .segments
            .iter()
            .filter(|segment| segment.track == "mic")
            .map(|segment| segment.duration_ms)
            .sum::<u64>()
            .max(1_000);

        let mic = final_dir.join("mic.wav");
        let system = final_dir.join("system.wav");
        let mixed = final_dir.join("mixed.wav");

        write_silence_wav(&mic, 48_000, 1, duration_ms)?;
        write_silence_wav(&system, 48_000, 2, duration_ms)?;
        write_silence_wav(&mixed, 48_000, 2, duration_ms)?;
        Ok(Some(mixed))
    }
}
