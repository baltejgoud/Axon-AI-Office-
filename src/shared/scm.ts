/** Who is signed in. Tokens never leave the main process; the office only sees these. */
export interface AccountProfile {
  /** GitHub's @login; empty for Google. */
  login: string;
  name: string;
  email: string;
  /** A `data:` URL, fetched once at sign-in (the office's pages load no remote images). */
  avatar: string;
}
export interface AccountsState {
  github: { configured: boolean; profile: AccountProfile | null };
  google: { configured: boolean; profile: AccountProfile | null };
  /** The installed Git's version, or null when Git isn't installed. */
  git: string | null;
}
/** GitHub's device sign-in: the code to type at the address, and when it stops working. */
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}
export interface RepoSummary {
  fullName: string;
  description: string;
  private: boolean;
  fork: boolean;
  updatedAt: string;
}
/** One changed file. Codes follow VS Code: M modified, A added, D deleted, R renamed, U untracked, C conflict. */
export interface ScmFile {
  path: string;
  origPath?: string;
  code: 'M' | 'A' | 'D' | 'R' | 'U' | 'C';
  /** Some or all of the change is staged for the next commit. */
  staged: boolean;
  /** Some of the change is not staged yet. */
  unstaged: boolean;
}
export interface ScmStatus {
  /** False when the open folder isn't a Git repository yet: the office offers Publish. */
  repo: boolean;
  /** Null while detached. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The `origin` remote, and whether it's on github.com. */
  remote: { url: string; github: boolean } | null;
  hasGitignore: boolean;
  files: ScmFile[];
}
export interface ScmDiff {
  before: string;
  after: string;
  /** Why no text is shown: binary, too large or a hidden file. */
  note?: string;
}
export interface PublishInput {
  name: string;
  description: string;
  private: boolean;
  /** Write a starter .gitignore first (only when the folder has none). */
  gitignore: boolean;
}
