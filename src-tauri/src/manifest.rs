use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::Context;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub recording_id: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub segment_duration_ms: u64,
    pub tracks: Tracks,
    pub segments: Vec<SegmentManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tracks {
    pub mic: TrackConfig,
    pub system: TrackConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackConfig {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub bitrate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentManifest {
    pub track: String,
    pub index: u32,
    pub path: String,
    pub duration_ms: u64,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub committed_at: DateTime<Utc>,
}

impl Manifest {
    pub fn new(recording_id: String) -> Self {
        Self {
            recording_id,
            status: "recording".to_string(),
            created_at: Utc::now(),
            completed_at: None,
            segment_duration_ms: 10_000,
            tracks: Tracks {
                mic: TrackConfig {
                    codec: "ogg_opus".to_string(),
                    sample_rate: 48_000,
                    channels: 1,
                    bitrate: 48_000,
                },
                system: TrackConfig {
                    codec: "ogg_opus".to_string(),
                    sample_rate: 48_000,
                    channels: 2,
                    bitrate: 96_000,
                },
            },
            segments: Vec::new(),
        }
    }

    pub fn path(recording_dir: &Path) -> PathBuf {
        recording_dir.join("manifest.json")
    }

    pub fn load(recording_dir: &Path) -> anyhow::Result<Self> {
        let path = Self::path(recording_dir);
        let content = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&content).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn save_atomic(&self, recording_dir: &Path) -> anyhow::Result<()> {
        let path = Self::path(recording_dir);
        let tmp_path = path.with_extension("json.tmp");
        let mut file = File::create(&tmp_path).with_context(|| format!("creating {}", tmp_path.display()))?;
        let payload = serde_json::to_vec_pretty(self)?;
        file.write_all(&payload)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, &path)
            .with_context(|| format!("renaming {} to {}", tmp_path.display(), path.display()))?;
        Ok(())
    }
}
