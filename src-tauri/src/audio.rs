use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_default: bool,
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

#[cfg(feature = "native-audio")]
fn list_native_devices() -> Vec<AudioDevice> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let default_input = host.default_input_device().and_then(|device| device.name().ok());
    let default_output = host.default_output_device().and_then(|device| device.name().ok());
    let mut devices = Vec::new();

    if let Ok(inputs) = host.input_devices() {
        for (index, device) in inputs.enumerate() {
            let name = device.name().unwrap_or_else(|_| format!("Input device {index}"));
            devices.push(AudioDevice {
                id: format!("input:{index}:{name}"),
                is_default: default_input.as_deref() == Some(name.as_str()),
                name,
                kind: "input".to_string(),
            });
        }
    }

    if let Ok(outputs) = host.output_devices() {
        for (index, device) in outputs.enumerate() {
            let name = device.name().unwrap_or_else(|_| format!("Output device {index}"));
            devices.push(AudioDevice {
                id: format!("output:{index}:{name}"),
                is_default: default_output.as_deref() == Some(name.as_str()),
                name,
                kind: "output".to_string(),
            });
        }
    }

    devices
}
