import type { Database } from '@/db';
import type { CreateResourceInput } from '@/domain/resource/types';
import type { CreateAvailabilityRuleInput } from '@/domain/rule/types';
import { AvailabilityRuleRepository } from '@/persistence/sqlite/AvailabilityRuleRepository';
import { RoomRepository } from '@/persistence/sqlite/RoomRepository';
import type { CreateRoomInput } from '@/domain/room/types';

interface ExistingTimestamps {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

function existingTimestamps(db: Database, table: string, id: string): ExistingTimestamps {
  const row = db.prepare(`SELECT created_at AS "createdAt", updated_at AS "updatedAt" FROM ${table} WHERE id = ?`).get(id) as
    | ExistingTimestamps
    | undefined;
  return row ?? { id };
}

function withExistingTimestamps<T extends ExistingTimestamps>(
  db: Database,
  table: string,
  input: T,
): T & ExistingTimestamps {
  return { ...input, ...existingTimestamps(db, table, input.id) };
}

export function seedBaselineRooms(db: Database): void {
  const rooms: CreateRoomInput[] = [
    {
      id: 'room-activity',
      name: '活动室',
      type: '多功能空间',
      capacity: 40,
      location: '公共活动区',
      equipment: ['投影', '音响'],
    },
    {
      id: 'room-meeting-1',
      name: '会议室一',
      type: '标准会议室',
      capacity: 12,
      location: '会议区',
      equipment: ['显示屏', '白板', '视频会议'],
    },
    {
      id: 'room-meeting-2',
      name: '会议室二',
      type: '标准会议室',
      capacity: 12,
      location: '会议区',
      equipment: ['显示屏', '白板', '视频会议'],
    },
    {
      id: 'room-combined',
      name: '组合空间',
      type: '组合会议室',
      capacity: 24,
      location: '会议区',
      equipment: ['显示屏', '白板', '视频会议'],
    },
    {
      id: 'room-502',
      name: '502',
      type: '小会议室',
      capacity: 6,
      location: '5楼',
      equipment: ['显示屏', '白板'],
    },
    {
      id: 'room-503',
      name: '503',
      type: '小会议室',
      capacity: 6,
      location: '5楼',
      equipment: ['显示屏', '白板'],
    },
    {
      id: 'room-504',
      name: '504',
      type: '小会议室',
      capacity: 6,
      location: '5楼',
      equipment: ['显示屏', '白板'],
    },
    {
      id: 'room-505',
      name: '505',
      type: '小会议室',
      capacity: 6,
      location: '5楼',
      equipment: ['显示屏', '白板'],
    },
    {
      id: 'room-506',
      name: '506',
      type: '小会议室',
      capacity: 6,
      location: '5楼',
      equipment: ['显示屏', '白板'],
    },
  ];

  const resources: CreateResourceInput[] = [
    { id: 'resource-activity', name: '活动室', type: 'activity-room' },
    { id: 'resource-meeting-1', name: '会议室一', type: 'standard-meeting-room' },
    { id: 'resource-meeting-2', name: '会议室二', type: 'standard-meeting-room' },
    { id: 'resource-502', name: '502', type: 'small-meeting-room' },
    { id: 'resource-503', name: '503', type: 'small-meeting-room' },
    { id: 'resource-504', name: '504', type: 'small-meeting-room' },
    { id: 'resource-505', name: '505', type: 'small-meeting-room' },
    { id: 'resource-506', name: '506', type: 'small-meeting-room' },
  ];

  const roomRepository = new RoomRepository(db);

  db.transaction(() => {
    roomRepository.upsertResources(
      resources.map((resource) => withExistingTimestamps(db, 'resources', resource)),
    );

    for (const room of rooms) {
      roomRepository.upsert(withExistingTimestamps(db, 'rooms', room));
    }

    roomRepository.replaceRoomResources('room-activity', ['resource-activity']);
    roomRepository.replaceRoomResources('room-meeting-1', ['resource-meeting-1']);
    roomRepository.replaceRoomResources('room-meeting-2', ['resource-meeting-2']);
    roomRepository.replaceRoomResources('room-combined', ['resource-meeting-1', 'resource-meeting-2']);
    roomRepository.replaceRoomResources('room-502', ['resource-502']);
    roomRepository.replaceRoomResources('room-503', ['resource-503']);
    roomRepository.replaceRoomResources('room-504', ['resource-504']);
    roomRepository.replaceRoomResources('room-505', ['resource-505']);
    roomRepository.replaceRoomResources('room-506', ['resource-506']);
  })();
}

export function seedBaselineRules(db: Database): void {
  const repository = new AvailabilityRuleRepository(db);
  const rules: CreateAvailabilityRuleInput[] = [
    {
      id: 'rule-activity-lunch-weekday',
      targetType: 'room',
      targetId: 'room-activity',
      ruleType: 'periodic_block',
      reason: '工作日午餐时段作为餐厅',
      recurrence: JSON.stringify({
        type: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        timeStart: '11:30',
        timeEnd: '13:30',
      }),
      start: '2026-01-05T03:30:00.000Z',
      end: '2026-01-05T05:30:00.000Z',
    },
    {
      id: 'rule-502-tuesday-all-day',
      targetType: 'room',
      targetId: 'room-502',
      ruleType: 'periodic_block',
      reason: '每周二全天不可用',
      recurrence: JSON.stringify({
        type: 'weekly',
        weekdays: [2],
        timeStart: '00:00',
        timeEnd: '24:00',
      }),
      start: '2026-01-06T16:00:00.000Z',
      end: '2026-01-07T16:00:00.000Z',
    },
  ];

  for (const rule of rules) {
    repository.upsert(withExistingTimestamps(db, 'availability_rules', rule));
  }
}

export function seedDatabase(db: Database): void {
  db.transaction(() => {
    seedBaselineRooms(db);
    seedBaselineRules(db);
  })();
}
