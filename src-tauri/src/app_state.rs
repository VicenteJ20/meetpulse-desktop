use std::sync::Arc;

use anyhow::Context;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::{
    paths::AppPaths,
    recorder::RecorderManager,
    recovery::RecoveryManager,
    storage::Storage,
};

pub struct AppState {
    pub recorder: Arc<Mutex<RecorderManager>>,
    pub storage: Arc<Storage>,
}

impl AppState {
    pub fn initialize(app: AppHandle) -> anyhow::Result<Self> {
        let paths = AppPaths::ensure().context("creating application data folders")?;
        let storage = Arc::new(Storage::open(paths.clone()).context("opening local SQLite store")?);
        storage.migrate().context("running local database migrations")?;

        let recovery = RecoveryManager::new(paths.clone(), storage.clone());
        recovery.run().context("recovering interrupted recordings")?;

        let recorder = RecorderManager::new(app, paths, storage.clone());

        Ok(Self {
            recorder: Arc::new(Mutex::new(recorder)),
            storage,
        })
    }
}
