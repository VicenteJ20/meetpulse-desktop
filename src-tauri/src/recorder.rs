use std::{
    fs::{self, File},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context};
use chrono::Utc;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::{
    audio::TrackHealth,
    finalizer::FinalAudioBuilder,
    manifest::{Manifest, SegmentManifest},
    paths::{ensure_recording_tree, AppPaths},
    storage::Storage,
    wav_writer::write_silence_wav,
};

const SEGMENT_DURATION: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize)]
pub struct RecorderSnapshot {
    pub status: String,
    pub recording_id: Option<String>,
    pub started_at: Option<String>,
    pub duration_ms: u64,
    pub segments_written: u32,
    pub disk_bytes: u64,
    pub mic: TrackHealth,
    pub system: TrackHealth,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct RecorderEvent {
    snapshot: RecorderSnapshot,
}

struct ActiveRecording {
    id: String,
    dir: PathBuf,
    manifest: Manifest,
    started: Instant,
    paused_total: Duration,
    paused_since: Option<Instant>,
    status: String,
    next_segment_index: u32,
    disk_bytes: u64,
    last_error: Option<String>,
}

impl ActiveRecording {
    fn snapshot(&self) -> RecorderSnapshot {
        let duration = if self.status == "paused" {
            self.paused_since
                .map(|paused_at| paused_at.saturating_duration_since(self.started).saturating_sub(self.paused_total))
                .unwrap_or_default()
        } else {
            self.started.elapsed().saturating_sub(self.paused_total)
        };

        let mic_health = match self.status.as_str() {
            "paused" => TrackHealth::paused(),
            "recording" => TrackHealth::recording(0.24),
            "stopping" => TrackHealth::ready("Cerrando"),
            _ => TrackHealth::ready("Listo"),
        };

        let system_health = match self.status.as_str() {
            "paused" => TrackHealth::paused(),
            "recording" => TrackHealth {
                status: "silent".to_string(),
                rms: 0.0,
                clipping: false,
                message: Some("WASAPI pendiente".to_string()),
            },
            "stopping" => TrackHealth::ready("Cerrando"),
            _ => TrackHealth::ready("WASAPI pendiente"),
        };

        RecorderSnapshot {
            status: self.status.clone(),
            recording_id: Some(self.id.clone()),
            started_at: Some(self.manifest.created_at.to_rfc3339()),
            duration_ms: duration.as_millis() as u64,
            segments_written: self.manifest.segments.len() as u32,
            disk_bytes: self.disk_bytes,
            mic: mic_health,
            system: system_health,
            last_error: self.last_error.clone(),
        }
    }
}

pub struct RecorderManager {
    app: AppHandle,
    paths: AppPaths,
    storage: Arc<Storage>,
    active: Option<Arc<StdMutex<ActiveRecording>>>,
    stop_flag: Arc<AtomicBool>,
}

impl RecorderManager {
    pub fn new(app: AppHandle, paths: AppPaths, storage: Arc<Storage>) -> Self {
        Self {
            app,
            paths,
            storage,
            active: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self) -> RecorderSnapshot {
        if let Some(active) = &self.active {
            return active.lock().expect("active recorder mutex poisoned").snapshot();
        }

        RecorderSnapshot {
            status: "idle".to_string(),
            recording_id: None,
            started_at: None,
            duration_ms: 0,
            segments_written: 0,
            disk_bytes: 0,
            mic: TrackHealth::ready("Microfono default"),
            system: TrackHealth::ready("Loopback default"),
            last_error: None,
        }
    }

    pub fn start(&mut self) -> anyhow::Result<RecorderSnapshot> {
        if self.active.is_some() {
            bail!("ya hay una grabacion activa");
        }

        self.stop_flag.store(false, Ordering::SeqCst);

        let id = create_recording_id();
        let dir = self.paths.recording_dir(&id);
        ensure_recording_tree(&dir)?;
        File::create(dir.join("lock"))?.sync_all()?;

        let manifest = Manifest::new(id.clone());
        manifest.save_atomic(&dir)?;
        self.storage
            .upsert_recording(&id, "recording", &manifest.created_at.to_rfc3339(), &dir.to_string_lossy())?;

        let active = Arc::new(StdMutex::new(ActiveRecording {
            id,
            dir,
            manifest,
            started: Instant::now(),
            paused_total: Duration::ZERO,
            paused_since: None,
            status: "recording".to_string(),
            next_segment_index: 1,
            disk_bytes: 0,
            last_error: None,
        }));

        self.spawn_segment_worker(active.clone());
        self.active = Some(active);
        let snapshot = self.snapshot();
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub fn pause(&mut self) -> anyhow::Result<RecorderSnapshot> {
        let active = self.require_active()?;
        let mut session = active.lock().expect("active recorder mutex poisoned");
        if session.status != "recording" {
            bail!("la grabacion no esta activa");
        }
        session.status = "paused".to_string();
        session.paused_since = Some(Instant::now());
        let snapshot = session.snapshot();
        drop(session);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub fn resume(&mut self) -> anyhow::Result<RecorderSnapshot> {
        let active = self.require_active()?;
        let mut session = active.lock().expect("active recorder mutex poisoned");
        if session.status != "paused" {
            bail!("la grabacion no esta pausada");
        }
        if let Some(paused_since) = session.paused_since.take() {
            session.paused_total += paused_since.elapsed();
        }
        session.status = "recording".to_string();
        let snapshot = session.snapshot();
        drop(session);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub fn stop(&mut self) -> anyhow::Result<RecorderSnapshot> {
        let active = self.require_active()?;
        self.stop_flag.store(true, Ordering::SeqCst);

        {
            let mut session = active.lock().expect("active recorder mutex poisoned");
            session.status = "stopping".to_string();
            self.emit_snapshot(&session.snapshot());
        }

        thread::sleep(Duration::from_millis(250));

        let mut session = active.lock().expect("active recorder mutex poisoned");
        if session.status == "recording" || session.status == "stopping" {
            write_track_pair(&mut session)?;
        }

        session.status = "completed".to_string();
        session.manifest.status = "completed".to_string();
        session.manifest.completed_at = Some(Utc::now());
        session.manifest.save_atomic(&session.dir)?;
        let final_path = FinalAudioBuilder::build(&session.dir, &session.manifest)?;
        let final_path_string = final_path.as_ref().map(|path| path.to_string_lossy().to_string());
        let duration_ms = session.snapshot().duration_ms;
        self.storage.update_recording_completed(
            &session.id,
            "completed",
            &Utc::now().to_rfc3339(),
            duration_ms,
            final_path_string.as_deref(),
        )?;
        let _ = fs::remove_file(session.dir.join("lock"));

        let snapshot = session.snapshot();
        drop(session);
        self.active = None;
        self.emit_snapshot(&snapshot);
        let _ = self.app.emit("recorder://recordings-changed", ());
        Ok(snapshot)
    }

    fn require_active(&self) -> anyhow::Result<Arc<StdMutex<ActiveRecording>>> {
        self.active.clone().context("no hay una grabacion activa")
    }

    fn spawn_segment_worker(&self, active: Arc<StdMutex<ActiveRecording>>) {
        let storage = self.storage.clone();
        let app = self.app.clone();
        let stop_flag = self.stop_flag.clone();

        thread::spawn(move || loop {
            thread::sleep(SEGMENT_DURATION);
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            let result = {
                let mut session = active.lock().expect("active recorder mutex poisoned");
                if session.status != "recording" {
                    Ok(None)
                } else {
                    write_track_pair(&mut session).map(|_| Some(session.snapshot()))
                }
            };

            match result {
                Ok(Some(snapshot)) => {
                    if let Some(recording_id) = snapshot.recording_id.as_deref() {
                        if let Ok(session) = active.lock() {
                            for segment in session.manifest.segments.iter().rev().take(2) {
                                let _ = storage.insert_segment(recording_id, segment);
                            }
                        }
                    }
                    let _ = app.emit("recorder://snapshot", RecorderEvent { snapshot });
                    let _ = app.emit("recorder://recordings-changed", ());
                }
                Ok(None) => {}
                Err(error) => {
                    if let Ok(mut session) = active.lock() {
                        session.last_error = Some(error.to_string());
                        let _ = app.emit(
                            "recorder://snapshot",
                            RecorderEvent {
                                snapshot: session.snapshot(),
                            },
                        );
                    }
                }
            }
        });
    }

    fn emit_snapshot(&self, snapshot: &RecorderSnapshot) {
        let _ = self.app.emit(
            "recorder://snapshot",
            RecorderEvent {
                snapshot: snapshot.clone(),
            },
        );
    }
}

fn write_track_pair(session: &mut ActiveRecording) -> anyhow::Result<()> {
    let index = session.next_segment_index;
    let mic = write_segment(&session.dir, "mic", index, 1)?;
    let system = write_segment(&session.dir, "system", index, 2)?;

    session.disk_bytes += mic.size_bytes + system.size_bytes;
    session.manifest.segments.push(mic);
    session.manifest.segments.push(system);
    session.manifest.save_atomic(&session.dir)?;
    session.next_segment_index += 1;
    Ok(())
}

fn write_segment(
    recording_dir: &std::path::Path,
    track: &str,
    index: u32,
    channels: u16,
) -> anyhow::Result<SegmentManifest> {
    let file_name = format!("{index:06}.wav");
    let relative_path = format!("{track}/{file_name}");
    let final_path = recording_dir.join(&relative_path);
    let tmp_path = final_path.with_extension("wav.tmp");

    write_silence_wav(&tmp_path, 48_000, channels, SEGMENT_DURATION.as_millis() as u64)
        .with_context(|| format!("creating {}", tmp_path.display()))?;
    fs::rename(&tmp_path, &final_path)
        .with_context(|| format!("committing {} to {}", tmp_path.display(), final_path.display()))?;

    let payload = fs::read(&final_path)?;
    let mut hash = Sha256::new();
    hash.update(&payload);
    let sha256 = format!("{:x}", hash.finalize());

    Ok(SegmentManifest {
        track: track.to_string(),
        index,
        path: relative_path,
        duration_ms: SEGMENT_DURATION.as_millis() as u64,
        size_bytes: payload.len() as u64,
        sha256: Some(sha256),
        committed_at: Utc::now(),
    })
}

fn create_recording_id() -> String {
    let suffix = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect::<String>()
        .to_lowercase();
    format!("rec_{}_{}", Utc::now().format("%Y-%m-%d_%H-%M-%S"), suffix)
}
