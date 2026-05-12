use std::{fs, sync::Arc};

use anyhow::Context;
use chrono::Utc;

use crate::{manifest::Manifest, paths::AppPaths, storage::Storage};

pub struct RecoveryManager {
    paths: AppPaths,
    storage: Arc<Storage>,
}

impl RecoveryManager {
    pub fn new(paths: AppPaths, storage: Arc<Storage>) -> Self {
        Self { paths, storage }
    }

    pub fn run(&self) -> anyhow::Result<()> {
        if !self.paths.recordings.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(&self.paths.recordings)? {
            let entry = entry?;
            let recording_dir = entry.path();
            if !recording_dir.is_dir() {
                continue;
            }

            self.recover_recording(&recording_dir)
                .with_context(|| format!("recovering {}", recording_dir.display()))?;
        }

        Ok(())
    }

    fn recover_recording(&self, recording_dir: &std::path::Path) -> anyhow::Result<()> {
        self.remove_temp_files(recording_dir)?;

        let manifest_path = Manifest::path(recording_dir);
        if !manifest_path.exists() {
            return Ok(());
        }

        let mut manifest = Manifest::load(recording_dir)?;
        if manifest.status == "recording" || manifest.status == "stopping" {
            manifest.status = "interrupted_recovered".to_string();
            manifest.completed_at = Some(Utc::now());
            manifest.save_atomic(recording_dir)?;
        }

        self.storage.upsert_recording(
            &manifest.recording_id,
            &manifest.status,
            &manifest.created_at.to_rfc3339(),
            &recording_dir.to_string_lossy(),
        )?;

        for segment in &manifest.segments {
            if recording_dir.join(&segment.path).exists() {
                self.storage.insert_segment(&manifest.recording_id, segment)?;
            }
        }

        if matches!(manifest.status.as_str(), "completed" | "interrupted_recovered") {
            let final_audio_path = recording_dir.join("final").join("mixed.opus");
            let final_audio_path = final_audio_path.exists().then(|| final_audio_path.to_string_lossy().to_string());
            let completed_at = manifest.completed_at.unwrap_or_else(Utc::now);
            let duration_ms = manifest
                .completed_at
                .map(|completed_at| completed_at.signed_duration_since(manifest.created_at).num_milliseconds().max(0) as u64)
                .unwrap_or_else(|| manifest_duration_ms(&manifest));

            self.storage.update_recording_completed(
                &manifest.recording_id,
                &manifest.status,
                &completed_at.to_rfc3339(),
                duration_ms,
                final_audio_path.as_deref(),
            )?;
        }

        Ok(())
    }

    fn remove_temp_files(&self, recording_dir: &std::path::Path) -> anyhow::Result<()> {
        for track in ["mic", "system"] {
            let track_dir = recording_dir.join(track);
            if !track_dir.exists() {
                continue;
            }

            for entry in fs::read_dir(track_dir)? {
                let path = entry?.path();
                if path.extension().and_then(|value| value.to_str()) == Some("tmp") {
                    let _ = fs::remove_file(path);
                }
            }
        }

        let lock = recording_dir.join("lock");
        if lock.exists() {
            let _ = fs::remove_file(lock);
        }

        Ok(())
    }
}

fn manifest_duration_ms(manifest: &Manifest) -> u64 {
    let mut mic_duration = 0_u64;
    let mut system_duration = 0_u64;

    for segment in &manifest.segments {
        match segment.track.as_str() {
            "mic" => mic_duration = mic_duration.saturating_add(segment.duration_ms),
            "system" => system_duration = system_duration.saturating_add(segment.duration_ms),
            _ => {}
        }
    }

    mic_duration.max(system_duration)
}
