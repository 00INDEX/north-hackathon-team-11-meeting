export type ResourceType =
  | 'activity-room'
  | 'standard-meeting-room'
  | 'small-meeting-room'
  | string;

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceInput {
  id: string;
  name: string;
  type?: ResourceType;
  enabled?: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}
