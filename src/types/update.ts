/**
 * Shared types for the update/version-check feature.
 *
 * - Defines the shape of the response from GET /api/update
 */

/**
 * Status returned by the updater service when checking for remote updates.
 *
 * @property upToDate - Whether the local version matches the remote
 * @property currentCommit - The current local commit SHA
 * @property remoteCommit - The latest remote commit SHA
 * @property commitsBehind - Number of commits the local version is behind
 */
export interface RemoteStatus {
  upToDate: boolean;
  currentCommit: string;
  remoteCommit: string;
  commitsBehind: number;
}
