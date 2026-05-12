use std::{
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
};

use anyhow::Context;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::{
    audio::{self, AudioDeviceSelection},
    paths::AppPaths,
    recorder::RecorderManager,
    recovery::RecoveryManager,
    storage::Storage,
};

pub struct AppState {
    pub recorder: Arc<Mutex<RecorderManager>>,
    pub storage: Arc<Storage>,
    pub audio_devices: Arc<StdMutex<AudioDeviceSelection>>,
    pub audio_device_config: PathBuf,
}

impl AppState {
    pub fn initialize(app: AppHandle) -> anyhow::Result<Self> {
        let paths = AppPaths::ensure().context("creating application data folders")?;
        let storage = Arc::new(Storage::open(paths.clone()).context("opening local SQLite store")?);
        storage.migrate().context("running local database migrations")?;
        let audio_device_config = paths.config.join("audio-devices.json");
        let audio_devices = Arc::new(StdMutex::new(
            audio::load_device_selection(&audio_device_config).unwrap_or_default(),
        ));

        let recovery = RecoveryManager::new(paths.clone(), storage.clone());
        std::thread::spawn(move || {
            if let Err(error) = recovery.run() {
                tracing::warn!(%error, "background recovery failed");
            }
        });

        let recorder = RecorderManager::new(app, paths, storage.clone(), audio_devices.clone());

        Ok(Self {
            recorder: Arc::new(Mutex::new(recorder)),
            storage,
            audio_devices,
            audio_device_config,
        })
    }
}
