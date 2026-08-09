import { useStore } from 'reactflow' // RF connection drag state

/** True while the user is dragging a new or reconnecting thread. */
export function useIsThreadConnecting(): boolean {
  return useStore((s) => !!s.connectionNodeId) // Set for the duration of connect/reconnect
}
