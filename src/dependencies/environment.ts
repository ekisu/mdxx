export interface DependencyEnvironment {
  directory: string;
  mappings: Map<string, string>;
  dispose(): Promise<void>;
}
