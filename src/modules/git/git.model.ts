export interface CloneProjectPayload {
  name: string;
  repoUrl: string;
  branch?: string;
  envContent?: string;
  autoStart?: boolean;
}
