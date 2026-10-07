import { ref } from "vue";
import { CHANNEL_NAME, LOCK_KEY } from "../data/seed";

interface LockBody {
  owner: string;
  acquiredAt: number;
  beatAt: number;
}

const HEARTBEAT_MS = 1500;
const STALE_MS = 5000;

/**
 * 多标签页协调：同一时刻只允许一个标签页成为 leader 执行写入（入队、冲突处理、批准、回滚），
 * 其余标签页只读并通过 storage 事件同步状态。leader 心跳过期后其他标签页可接管。
 */
export function createLeaderCoordinator(onInvalidate: () => void) {
  const isLeader = ref(false);
  const leaderOwner = ref<string | null>(null);
  const leaderSince = ref<number | null>(null);
  const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let channel: BroadcastChannel | null = null;
  let timer: number | null = null;

  function readLock(): LockBody | null {
    try {
      const raw = localStorage.getItem(LOCK_KEY);
      return raw ? (JSON.parse(raw) as LockBody) : null;
    } catch {
      return null;
    }
  }

  function writeLock(body: LockBody) {
    localStorage.setItem(LOCK_KEY, JSON.stringify(body));
  }

  function refreshLeaderInfo() {
    const lock = readLock();
    if (lock && Date.now() - lock.beatAt < STALE_MS) {
      leaderOwner.value = lock.owner;
    } else {
      leaderOwner.value = null;
    }
  }

  function becomeLeader() {
    if (isLeader.value) return;
    writeLock({ owner: tabId, acquiredAt: Date.now(), beatAt: Date.now() });
    isLeader.value = true;
    leaderOwner.value = tabId;
    leaderSince.value = Date.now();
    channel?.postMessage({ type: "leader-changed", owner: tabId });
  }

  function stepDown() {
    if (!isLeader.value) return;
    const lock = readLock();
    if (lock?.owner === tabId) localStorage.removeItem(LOCK_KEY);
    isLeader.value = false;
    leaderSince.value = null;
    refreshLeaderInfo();
    channel?.postMessage({ type: "leader-changed", owner: leaderOwner.value });
  }

  function tryAcquireOrHeartbeat() {
    const lock = readLock();
    const now = Date.now();
    if (!lock || now - lock.beatAt >= STALE_MS) {
      becomeLeader();
      return;
    }
    if (lock.owner === tabId) {
      if (!isLeader.value) {
        // 锁还在但本页状态丢失（如 storage 被清），恢复
        becomeLeader();
      } else {
        writeLock({ ...lock, beatAt: now });
        leaderOwner.value = tabId;
      }
      return;
    }
    // 别人持锁：如果自己曾是 leader，说明被接管，本页降级为只读
    if (isLeader.value) {
      isLeader.value = false;
      leaderSince.value = null;
      onInvalidate();
    }
    leaderOwner.value = lock.owner;
  }

  function onStorage(event: StorageEvent) {
    if (event.key === LOCK_KEY) refreshLeaderInfo();
  }

  function start() {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
    window.addEventListener("storage", onStorage);
    tryAcquireOrHeartbeat();
    timer = window.setInterval(tryAcquireOrHeartbeat, HEARTBEAT_MS);
    window.addEventListener("beforeunload", () => {
      const lock = readLock();
      if (lock?.owner === tabId) localStorage.removeItem(LOCK_KEY);
      channel?.postMessage({ type: "leader-changed", owner: null });
    });
  }

  return { isLeader, leaderOwner, tabId, start, stepDown, refreshLeaderInfo };
}
