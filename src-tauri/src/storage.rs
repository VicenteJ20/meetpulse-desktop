use std::{path::PathBuf, sync::Mutex};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::{manifest::SegmentManifest, paths::AppPaths};

#[derive(Debug, Clone, Serialize)]
pub struct RecordingSummary {
    pub id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub duration_ms: u64,
    pub folder_path: String,
    pub final_audio_path: Option<String>,
    pub segments: u32,
    pub size_bytes: u64,
}

pub struct Storage {
    paths: AppPaths,
    connection: Mutex<Connection>,
}

impl Storage {
    pub fn open(paths: AppPaths) -> anyhow::Result<Self> {
        let connection = Connection::open(paths.sqlite_path()).context("opening SQLite database")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;

        Ok(Self {
            paths,
            connection: Mutex::new(connection),
        })
    }

    pub fn migrate(&self) -> anyhow::Result<()> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS recordings (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              started_at TEXT NOT NULL,
              completed_at TEXT,
              duration_ms INTEGER NOT NULL DEFAULT 0,
              folder_path TEXT NOT NULL,
              final_audio_path TEXT
            );

            CREATE TABLE IF NOT EXISTS segments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recording_id TEXT NOT NULL,
              track TEXT NOT NULL,
              segment_index INTEGER NOT NULL,
              path TEXT NOT NULL,
              status TEXT NOT NULL,
              duration_ms INTEGER NOT NULL,
              size_bytes INTEGER NOT NULL,
              sha256 TEXT,
              UNIQUE(recording_id, track, segment_index),
              FOREIGN KEY(recording_id) REFERENCES recordings(id)
            );

            CREATE TABLE IF NOT EXISTS app_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              level TEXT NOT NULL,
              source TEXT NOT NULL,
              message TEXT NOT NULL,
              recording_id TEXT
            );

            CREATE TABLE IF NOT EXISTS device_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              device_id TEXT NOT NULL,
              device_name TEXT NOT NULL,
              kind TEXT NOT NULL,
              is_default INTEGER NOT NULL
            );
            "#,
        )?;

        Ok(())
    }

    pub fn upsert_recording(
        &self,
        id: &str,
        status: &str,
        started_at: &str,
        folder_path: &str,
    ) -> anyhow::Result<()> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        connection.execute(
            r#"
            INSERT INTO recordings (id, status, started_at, folder_path)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status
            "#,
            params![id, status, started_at, folder_path],
        )?;
        Ok(())
    }

    pub fn update_recording_completed(
        &self,
        id: &str,
        status: &str,
        completed_at: &str,
        duration_ms: u64,
        final_audio_path: Option<&str>,
    ) -> anyhow::Result<()> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        connection.execute(
            r#"
            UPDATE recordings
            SET status = ?2, completed_at = ?3, duration_ms = ?4, final_audio_path = ?5
            WHERE id = ?1
            "#,
            params![id, status, completed_at, duration_ms, final_audio_path],
        )?;
        Ok(())
    }

    pub fn update_final_audio_path(&self, id: &str, final_audio_path: &str) -> anyhow::Result<()> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        connection.execute(
            r#"
            UPDATE recordings
            SET final_audio_path = ?2
            WHERE id = ?1
            "#,
            params![id, final_audio_path],
        )?;
        Ok(())
    }

    pub fn recording_final_audio_path(&self, recording_id: &str) -> anyhow::Result<Option<PathBuf>> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        let final_audio_path = connection
            .query_row(
                "SELECT final_audio_path FROM recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .map(PathBuf::from);

        Ok(final_audio_path)
    }

    pub fn insert_segment(&self, recording_id: &str, segment: &SegmentManifest) -> anyhow::Result<()> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        connection.execute(
            r#"
            INSERT INTO segments (
              recording_id, track, segment_index, path, status, duration_ms, size_bytes, sha256
            )
            VALUES (?1, ?2, ?3, ?4, 'committed', ?5, ?6, ?7)
            ON CONFLICT(recording_id, track, segment_index) DO UPDATE SET
              path = excluded.path,
              status = excluded.status,
              duration_ms = excluded.duration_ms,
              size_bytes = excluded.size_bytes,
              sha256 = excluded.sha256
            "#,
            params![
                recording_id,
                segment.track,
                segment.index,
                segment.path,
                segment.duration_ms,
                segment.size_bytes,
                segment.sha256
            ],
        )?;
        Ok(())
    }

    pub fn list_recordings(&self) -> anyhow::Result<Vec<RecordingSummary>> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        let mut statement = connection.prepare(
            r#"
            SELECT
              r.id,
              r.status,
              r.started_at,
              r.completed_at,
              r.duration_ms,
              r.folder_path,
              r.final_audio_path,
              COUNT(s.id) AS segments,
              COALESCE(SUM(s.size_bytes), 0) AS size_bytes
            FROM recordings r
            LEFT JOIN segments s ON s.recording_id = r.id
            GROUP BY r.id
            ORDER BY r.started_at DESC
            LIMIT 50
            "#,
        )?;

        let rows = statement.query_map([], |row| {
            Ok(RecordingSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                started_at: row.get(2)?,
                completed_at: row.get(3)?,
                duration_ms: row.get::<_, i64>(4)?.max(0) as u64,
                folder_path: row.get::<_, String>(5)?,
                final_audio_path: row.get(6)?,
                segments: row.get::<_, i64>(7)?.max(0) as u32,
                size_bytes: row.get::<_, i64>(8)?.max(0) as u64,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().context("listing recordings")
    }

    pub fn recording_folder(&self, recording_id: &str) -> PathBuf {
        self.paths.recording_dir(recording_id)
    }

    pub fn recording_open_folder(&self, recording_id: &str) -> anyhow::Result<PathBuf> {
        let connection = self.connection.lock().expect("SQLite mutex poisoned");
        let final_audio_path = connection
            .query_row(
                "SELECT final_audio_path FROM recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        if let Some(path) = final_audio_path.and_then(|path| PathBuf::from(path).parent().map(PathBuf::from)) {
            return Ok(path);
        }

        Ok(self.recording_folder(recording_id))
    }
}
