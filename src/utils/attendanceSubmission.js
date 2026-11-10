// Keep operation identities and uploaded evidence when a response is interrupted.
// A group may have saved some participants before the remaining request failed.
export function createAttendanceSubmissionTracker(makeId = () => crypto.randomUUID()) {
  let current = null;
  return {
    get(key, count, grouped) {
      if (!current || current.key !== key) current = { key,
        groupId: grouped ? 'attendance-group-' + makeId() : '',
        operations: Array.from({ length: count }, makeId), photo: null };
      return current;
    },
    clear() { current = null; },
  };
}
