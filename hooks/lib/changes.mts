// Finds the files a turn changed, however they changed, in every checkout the turn worked in.

/** The files one turn changed below one root, absolute, sorted and unique, deleted files included. The root is a git top level. */
export type Changes = {
  root: string;
  files: string[];
  /** The time in epoch milliseconds after which no new file is started, absent for no limit. */
  deadline?: number;
};
