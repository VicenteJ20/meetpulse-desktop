use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::manifest::Manifest;

pub struct FinalAudioBuilder;

impl FinalAudioBuilder {
    pub fn build(recording_dir: &Path, manifest: &Manifest) -> anyhow::Result<Option<PathBuf>> {
        let final_dir = recording_dir.join("final");
        fs::create_dir_all(&final_dir)?;

        let mut final_paths = Vec::new();
        for track in ["mic", "system"] {
            if let Some(segment) = manifest.segments.iter().rev().find(|segment| segment.track == track) {
                let source = recording_dir.join(&segment.path);
                if source.exists() {
                    let target = final_dir.join(format!("{track}.opus"));
                    fs::copy(&source, &target)?;
                    final_paths.push(target);
                }
            }
        }

        if final_paths.is_empty() {
            Ok(None)
        } else {
            Ok(Some(final_dir))
        }
    }
}
