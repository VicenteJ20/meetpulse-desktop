use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex as StdMutex,
    },
    thread,
    thread::JoinHandle,
    time::{Duration, Instant},
};

use anyhow::{bail, Context};
use chrono::{Local, Utc};
use directories::UserDirs;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::{
    audio::{AudioDeviceSelection, TrackHealth},
    finalizer::FinalAudioBuilder,
    manifest::{Manifest, SegmentManifest},
    native_audio::{f32_from_bits, f32_to_bits, record_segment_to_opus},
    notifications::notify_draft_saved,
    paths::{ensure_recording_tree, AppPaths},
    storage::Storage,
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

#[derive(Debug, Clone, Serialize)]
struct DraftSavedEvent {
    recording_id: String,
    path: String,
}

struct ActiveRecording {
    id: String,
    dir: PathBuf,
    manifest: Manifest,
    started: Instant,
    paused_total: Duration,
    paused_since: Option<Instant>,
    status: String,
    disk_bytes: u64,
    mic_rms: Arc<AtomicU32>,
    system_rms: Arc<AtomicU32>,
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
            "recording" => TrackHealth::recording(f32_from_bits(self.mic_rms.load(Ordering::Relaxed))),
            "stopping" => TrackHealth::ready("Cerrando"),
            _ => TrackHealth::ready("Listo"),
        };

        let system_health = match self.status.as_str() {
            "paused" => TrackHealth::paused(),
            "recording" => TrackHealth {
                status: "recording".to_string(),
                rms: f32_from_bits(self.system_rms.load(Ordering::Relaxed)),
                clipping: false,
                message: Some("WASAPI loopback".to_string()),
            },
            "stopping" => TrackHealth::ready("Cerrando"),
            _ => TrackHealth::ready("Loopback de escritorio"),
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
    audio_devices: Arc<StdMutex<AudioDeviceSelection>>,
    active: Option<Arc<StdMutex<ActiveRecording>>>,
    stop_flag: Arc<AtomicBool>,
    workers: Vec<JoinHandle<()>>,
}

impl RecorderManager {
    pub fn new(
        app: AppHandle,
        paths: AppPaths,
        storage: Arc<Storage>,
        audio_devices: Arc<StdMutex<AudioDeviceSelection>>,
    ) -> Self {
        Self {
            app,
            paths,
            storage,
            audio_devices,
            active: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            workers: Vec::new(),
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
            disk_bytes: 0,
            mic_rms: Arc::new(AtomicU32::new(f32_to_bits(0.02))),
            system_rms: Arc::new(AtomicU32::new(f32_to_bits(0.02))),
            last_error: None,
        }));

        self.workers.push(self.spawn_snapshot_worker(active.clone()));
        self.workers.push(self.spawn_track_worker(active.clone(), "mic"));
        self.workers.push(self.spawn_track_worker(active.clone(), "system"));
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

        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }

        let finalize_result = {
            let mut session = active.lock().expect("active recorder mutex poisoned");
            let result = (|| -> anyhow::Result<(String, String)> {
                session.status = "completed".to_string();
                session.manifest.status = "completed".to_string();
                session.manifest.completed_at = Some(Utc::now());
                session.manifest.save_atomic(&session.dir)?;
                let final_path = FinalAudioBuilder::build(&session.dir, &session.manifest)?;
                let final_path = final_path.context("no se pudo generar audio final para guardar en borradores")?;
                let draft_path = save_automatic_draft(&final_path, &session.manifest.created_at)?;
                if !draft_path.exists() {
                    bail!("no se pudo confirmar el borrador en {}", draft_path.display());
                }
                let final_path_string = draft_path.to_string_lossy().to_string();
                let duration_ms = session.snapshot().duration_ms;
                self.storage.update_recording_completed(
                    &session.id,
                    "completed",
                    &Utc::now().to_rfc3339(),
                    duration_ms,
                    Some(final_path_string.as_str()),
                )?;
                Ok((session.id.clone(), final_path_string))
            })();

            if let Err(error) = &result {
                session.status = "error".to_string();
                session.last_error = Some(error.to_string());
                self.emit_snapshot(&session.snapshot());
            }
            let _ = fs::remove_file(session.dir.join("lock"));
            result
        };

        self.active = None;
        let snapshot = self.snapshot();
        self.emit_snapshot(&snapshot);
        let (recording_id, final_path_string) = finalize_result?;
        if let Err(error) = notify_draft_saved(Path::new(&final_path_string)) {
            tracing::warn!(%error, "could not show native draft notification");
        }
        let _ = self.app.emit(
            "recorder://draft-saved",
            DraftSavedEvent {
                recording_id,
                path: final_path_string,
            },
        );
        let _ = self.app.emit("recorder://recordings-changed", ());
        Ok(snapshot)
    }

    fn require_active(&self) -> anyhow::Result<Arc<StdMutex<ActiveRecording>>> {
        self.active.clone().context("no hay una grabacion activa")
    }

    fn spawn_track_worker(&self, active: Arc<StdMutex<ActiveRecording>>, track: &'static str) -> JoinHandle<()> {
        let storage = self.storage.clone();
        let app = self.app.clone();
        let stop_flag = self.stop_flag.clone();
        let audio_devices = self.audio_devices.clone();

        thread::spawn(move || {
            let mut index = 1_u32;

            loop {
                if stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                let (recording_dir, recording_id, should_record, rms_meter, device_id) = {
                    let session = active.lock().expect("active recorder mutex poisoned");
                    let device_id = audio_devices
                        .lock()
                        .expect("audio device selection mutex poisoned")
                        .device_id_for_track(track);
                    (
                        session.dir.clone(),
                        session.id.clone(),
                        session.status == "recording",
                        if track == "mic" {
                            session.mic_rms.clone()
                        } else {
                            session.system_rms.clone()
                        },
                        device_id,
                    )
                };

                if !should_record {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }

                let result = write_native_segment(&recording_dir, track, index, stop_flag.clone(), rms_meter, device_id).and_then(|segment| {
                    let mut session = active.lock().expect("active recorder mutex poisoned");
                    if session.status == "recording" || session.status == "stopping" {
                        session.disk_bytes += segment.size_bytes;
                        session.manifest.segments.push(segment.clone());
                        session.manifest.save_atomic(&session.dir)?;
                        storage.insert_segment(&recording_id, &segment)?;
                        Ok(Some(session.snapshot()))
                    } else {
                        Ok(None)
                    }
                });

                match result {
                    Ok(Some(snapshot)) => {
                        let _ = app.emit("recorder://snapshot", RecorderEvent { snapshot });
                        let _ = app.emit("recorder://recordings-changed", ());
                        index += 1;
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
                        thread::sleep(Duration::from_millis(500));
                    }
                }
            }
        })
    }

    fn spawn_snapshot_worker(&self, active: Arc<StdMutex<ActiveRecording>>) -> JoinHandle<()> {
        let app = self.app.clone();
        let stop_flag = self.stop_flag.clone();

        thread::spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(500));
                if let Ok(session) = active.lock() {
                    if session.status == "recording" {
                        let _ = app.emit(
                            "recorder://snapshot",
                            RecorderEvent {
                                snapshot: session.snapshot(),
                            },
                        );
                    }
                }
            }
        })
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

fn write_native_segment(
    recording_dir: &std::path::Path,
    track: &str,
    index: u32,
    stop_flag: Arc<AtomicBool>,
    rms_meter: Arc<AtomicU32>,
    device_id: Option<String>,
) -> anyhow::Result<SegmentManifest> {
    if track != "mic" && track != "system" {
        bail!("track desconocido: {track}");
    }

    let file_name = format!("{index:06}.opus");
    let relative_path = format!("{track}/{file_name}");
    let final_path = recording_dir.join(&relative_path);
    let tmp_path = final_path.with_extension("opus.tmp");

    record_segment_to_opus(track, &tmp_path, SEGMENT_DURATION, stop_flag, rms_meter, device_id.as_deref())
        .with_context(|| format!("capturing native {track} to {}", tmp_path.display()))?;
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

fn save_automatic_draft(source: &Path, created_at: &chrono::DateTime<Utc>) -> anyhow::Result<PathBuf> {
    let user_dirs = UserDirs::new().context("resolving user directories")?;
    let music = user_dirs.home_dir().join("Music");
    let drafts_dir = music.join("MeetPulse").join("drafts");
    fs::create_dir_all(&drafts_dir).with_context(|| format!("creating {}", drafts_dir.display()))?;

    let base_name = created_at
        .with_timezone(&Local)
        .format("grabacion_%d_%m_%Y_%H_%M")
        .to_string();
    let destination = available_opus_path(&drafts_dir, &base_name);
    copy_atomic(source, &destination)?;
    Ok(destination)
}

fn available_opus_path(dir: &Path, base_name: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base_name}.opus"));
    let mut suffix = 2_u32;
    while candidate.exists() {
        candidate = dir.join(format!("{base_name}_{suffix}.opus"));
        suffix += 1;
    }
    candidate
}

fn copy_atomic(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let tmp = destination.with_extension("opus.tmp");
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    let result = (|| {
        fs::copy(source, &tmp).with_context(|| format!("copying {} to {}", source.display(), tmp.display()))?;
        let file = fs::File::open(&tmp)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, destination)
            .with_context(|| format!("committing {} to {}", tmp.display(), destination.display()))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }

    result
}
