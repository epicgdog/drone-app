import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { PoseSocket, PoseSocketStats } from "../net/poseSocket";

const POLL_MS = 250;

const EMPTY_STATS: PoseSocketStats = {
  sentPerSec: 0,
  recvPerSec: 0,
  lastRttMs: null,
  lastServerTotalMs: null,
  lastStatus: null,
};

interface StatsOverlayProps {
  socket: PoseSocket;
}

export function StatsOverlay({ socket }: StatsOverlayProps) {
  const [stats, setStats] = useState<PoseSocketStats>(EMPTY_STATS);

  useEffect(() => {
    const id = setInterval(() => setStats(socket.getStats()), POLL_MS);
    return () => clearInterval(id);
  }, [socket]);

  return (
    <View style={styles.card}>
      <Text style={styles.line}>sent/s: {stats.sentPerSec.toFixed(1)}</Text>
      <Text style={styles.line}>recv/s: {stats.recvPerSec.toFixed(1)}</Text>
      <Text style={styles.line}>
        rtt: {stats.lastRttMs != null ? `${stats.lastRttMs.toFixed(0)}ms` : "—"}
      </Text>
      <Text style={styles.line}>
        infer:{" "}
        {stats.lastServerTotalMs != null
          ? `${stats.lastServerTotalMs.toFixed(0)}ms`
          : "—"}
      </Text>
      <Text style={styles.line}>status: {stats.lastStatus ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 8,
    padding: 8,
  },
  line: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Menlo",
  },
});
