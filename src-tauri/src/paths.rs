use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use directories::BaseDirs;

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub logs: PathBuf,
    pub db: PathBuf,
    pub recordings: PathBuf,
    pub temp: PathBuf,
}

impl AppPaths {
    pub fn ensure() -> anyhow::Result<Self> {
        let base = BaseDirs::new().context("resolving user directories")?;
        let root = base.data_local_dir().join("MeetingsAssistant");
        let paths = Self {
            config: root.join("config"),
            logs: root.join("logs"),
            db: root.join("db"),
            recordings: root.join("recordings"),
            temp: root.join("temp"),
            root,
        };

        for path in [&paths.root, &paths.config, &paths.logs, &paths.db, &paths.recordings, &paths.temp] {
            fs::create_dir_all(path).with_context(|| format!("creating {}", path.display()))?;
        }

        Ok(paths)
    }

    pub fn recording_dir(&self, recording_id: &str) -> PathBuf {
        self.recordings.join(recording_id)
    }

    pub fn sqlite_path(&self) -> PathBuf {
        self.db.join("app.sqlite")
    }
}

pub fn ensure_recording_tree(recording_dir: &Path) -> anyhow::Result<()> {
    for path in [
        recording_dir,
        &recording_dir.join("mic"),
        &recording_dir.join("system"),
        &recording_dir.join("final"),
    ] {
        fs::create_dir_all(path).with_context(|| format!("creating {}", path.display()))?;
    }

    Ok(())
}
