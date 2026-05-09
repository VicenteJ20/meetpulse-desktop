use std::{
    fs,
    path::Path,
};

use anyhow::Context;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AudioDeviceSelection {
    pub input_device_id: Option<String>,
    pub output_device_id: Option<String>,
}

impl AudioDeviceSelection {
    pub fn device_id_for_track(&self, track: &str) -> Option<String> {
        match track {
            "mic" => self.input_device_id.clone(),
            "system" => self.output_device_id.clone(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackHealth {
    pub status: String,
    pub rms: f32,
    pub clipping: bool,
    pub message: Option<String>,
}

impl TrackHealth {
    pub fn ready(message: impl Into<String>) -> Self {
        Self {
            status: "ready".to_string(),
            rms: 0.0,
            clipping: false,
            message: Some(message.into()),
        }
    }

    pub fn recording(rms: f32) -> Self {
        Self {
            status: "recording".to_string(),
            rms,
            clipping: rms >= 0.98,
            message: None,
        }
    }

    pub fn paused() -> Self {
        Self {
            status: "paused".to_string(),
            rms: 0.0,
            clipping: false,
            message: Some("Pausado".to_string()),
        }
    }

}

pub fn list_devices() -> Vec<AudioDevice> {
    #[cfg(feature = "native-audio")]
    {
        list_native_devices()
    }

    #[cfg(not(feature = "native-audio"))]
    {
        vec![
            AudioDevice {
                id: "default-input".to_string(),
                name: "Default microphone".to_string(),
                kind: "input".to_string(),
                is_default: true,
            },
            AudioDevice {
                id: "default-output-loopback".to_string(),
                name: "Default system output loopback".to_string(),
                kind: "output".to_string(),
                is_default: true,
            },
        ]
    }
}

pub fn load_device_selection(path: &Path) -> anyhow::Result<AudioDeviceSelection> {
    if !path.exists() {
        return Ok(AudioDeviceSelection::default());
    }

    let contents = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&contents).with_context(|| format!("parsing {}", path.display()))
}

pub fn save_device_selection(path: &Path, selection: &AudioDeviceSelection) -> anyhow::Result<()> {
    let parent = path.parent().context("audio device settings path has no parent")?;
    fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    let payload = serde_json::to_vec_pretty(selection)?;
    fs::write(path, payload).with_context(|| format!("writing {}", path.display()))
}

#[cfg(feature = "native-audio")]
fn list_native_devices() -> Vec<AudioDevice> {
    use wasapi::{initialize_mta, Direction};

    let _ = initialize_mta().ok();
    let default_input = default_wasapi_device_name(&Direction::Capture);
    let default_output = default_wasapi_device_name(&Direction::Render);
    let mut devices = Vec::new();

    devices.extend(list_wasapi_devices(&Direction::Capture, "input", default_input.as_deref()));
    devices.extend(list_wasapi_devices(&Direction::Render, "output", default_output.as_deref()));

    devices
}

#[cfg(feature = "native-audio")]
fn list_wasapi_devices(direction: &wasapi::Direction, kind: &str, default_name: Option<&str>) -> Vec<AudioDevice> {
    let Ok(collection) = wasapi::DeviceCollection::new(direction) else {
        return Vec::new();
    };

    let Ok(count) = collection.get_nbr_devices() else {
        return Vec::new();
    };

    let mut devices = Vec::with_capacity(count as usize);
    for index in 0..count {
        let name = collection
            .get_device_at_index(index)
            .and_then(|device| device.get_friendlyname())
            .unwrap_or_else(|_| format!("{kind} device {index}"));
        devices.push(AudioDevice {
            id: format!("{kind}:{index}:{name}"),
            is_default: default_name == Some(name.as_str()),
            name,
            kind: kind.to_string(),
        });
    }
    devices
}

#[cfg(feature = "native-audio")]
fn default_wasapi_device_name(direction: &wasapi::Direction) -> Option<String> {
    wasapi::get_default_device(direction)
        .and_then(|device| device.get_friendlyname())
        .ok()
}
