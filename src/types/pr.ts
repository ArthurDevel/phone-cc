export interface PullRequest {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  createdAt: string;
  headBranch: string;
  baseBranch: string;
}
