use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;

use crate::{manifest::Manifest, native_audio::build_mixed_opus};

pub struct FinalAudioBuilder;

impl FinalAudioBuilder {
    pub fn build(recording_dir: &Path, manifest: &Manifest) -> anyhow::Result<Option<PathBuf>> {
        let final_dir = recording_dir.join("final");
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir)
                .with_context(|| format!("cleaning final directory {}", final_dir.display()))?;
        }
        fs::create_dir_all(&final_dir)?;

        let mixed_path = final_dir.join("mixed.opus");
        let tmp_path = final_dir.join("mixed.opus.tmp");
        let has_audio = match build_mixed_opus(recording_dir, manifest, &tmp_path)
            .with_context(|| format!("building {}", tmp_path.display()))
        {
            Ok(has_audio) => has_audio,
            Err(error) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(error);
            }
        };

        if has_audio {
            fs::rename(&tmp_path, &mixed_path)
                .with_context(|| format!("committing {} to {}", tmp_path.display(), mixed_path.display()))?;
            Ok(Some(mixed_path))
        } else {
            let _ = fs::remove_file(&tmp_path);
            Ok(None)
        }
    }
}
