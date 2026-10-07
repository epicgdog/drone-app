import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { FrameStreamer, pickPictureSize } from "./camera/FrameStreamer";
import { DEFAULT_SERVER_URL, SERVER_URL_STORAGE_KEY } from "./config";
import { ConnectionStatus, PoseSocket } from "./net/poseSocket";
import { StatsOverlay } from "./ui/StatsOverlay";

// The phone only streams camera frames and shows stats. Poses are rendered in
// the browser viewer served by the pose server (GET /viewer).

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = !!permission?.granted;
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [urlDraft, setUrlDraft] = useState(DEFAULT_SERVER_URL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const socket = useMemo(() => new PoseSocket(serverUrl), []);
  const streamingActive =
    connectionStatus === "connected" && hasPermission && cameraReady;

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const onCameraReady = async () => {
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      setPictureSize(pickPictureSize(sizes));
    } catch (err) {
      console.warn("Could not read picture sizes; using the default", err);
    }
    setCameraReady(true);
  };

  useEffect(() => {
    AsyncStorage.getItem(SERVER_URL_STORAGE_KEY).then((saved) => {
      if (saved) {
        setServerUrl(saved);
        setUrlDraft(saved);
        socket.setUrl(saved);
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribe = socket.onStatusChange(setConnectionStatus);
    socket.connect();
    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, [socket]);

  const saveServerUrl = async (url: string) => {
    setServerUrl(url);
    socket.setUrl(url);
    await AsyncStorage.setItem(SERVER_URL_STORAGE_KEY, url);
    setSettingsOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.camera}>
        {hasPermission ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            pictureSize={pictureSize}
            onCameraReady={onCameraReady}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.cameraFallback]}>
            <Text style={styles.fallbackText}>
              Camera permission needed
            </Text>
          </View>
        )}
      </View>

      <FrameStreamer
        cameraRef={cameraRef}
        active={streamingActive}
        socket={socket}
      />

      <View style={styles.overlay}>
        <View style={styles.overlayLeft}>
          <View
            style={[
              styles.connectionDot,
              {
                backgroundColor:
                  connectionStatus === "connected" ? "#22c55e" : "#ef4444",
              },
            ]}
          />
          <StatsOverlay socket={socket} />
        </View>
        <Pressable
          style={styles.settingsButton}
          onPress={() => {
            setUrlDraft(serverUrl);
            setSettingsOpen(true);
          }}
        >
          <Text style={styles.settingsButtonText}>⚙︎</Text>
        </Pressable>
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalLabel}>Server URL</Text>
            <TextInput
              style={styles.modalInput}
              value={urlDraft}
              onChangeText={setUrlDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={DEFAULT_SERVER_URL}
            />
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setSettingsOpen(false)}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => saveServerUrl(urlDraft)}>
                <Text style={styles.modalButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  cameraFallback: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
  },
  fallbackText: {
    color: "#fff",
  },
  overlay: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  overlayLeft: {
    gap: 6,
  },
  connectionDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  settingsButtonText: {
    color: "#fff",
    fontSize: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: "85%",
    backgroundColor: "#1c1c1e",
    borderRadius: 12,
    padding: 16,
  },
  modalLabel: {
    color: "#fff",
    marginBottom: 8,
  },
  modalInput: {
    color: "#fff",
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  modalButtonText: {
    color: "#3b82f6",
    fontSize: 16,
  },
});
