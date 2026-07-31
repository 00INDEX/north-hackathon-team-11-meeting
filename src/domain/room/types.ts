export type RoomType =
  "多功能空间" | "标准会议室" | "组合会议室" | "小会议室" | string;

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  location: string;
  equipment: string[];
  enabled: boolean;
  openStart: string;
  openEnd: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomInput {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  location: string;
  equipment?: string[];
  enabled?: boolean;
  openStart?: string;
  openEnd?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Minimal RFC-0004 extension for composing one logical room from existing
 * physical room resources.
 */
export interface CreateCombinedRoomInput {
  id: string;
  name?: string;
  componentRoomIds: string[];
  capacity?: number;
  location?: string;
  equipment?: string[];
}

export interface UpdateRoomInput {
  name?: string;
  type?: RoomType;
  capacity?: number;
  location?: string;
  equipment?: string[];
  enabled?: boolean;
  openStart?: string;
  openEnd?: string;
  version?: number;
}

export interface RoomResourceMapping {
  roomId: string;
  resourceId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  name: string;
  type: RoomType;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceInput {
  id: string;
  name: string;
  type?: RoomType;
  enabled?: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}
