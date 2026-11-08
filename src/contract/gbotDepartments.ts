/**
 * GBots' departments as `ghostex gbots department list --json` answers them (server/src/gbots/departments.rs
 * `department_summary`): each with its shared instructions, its lead and its members, and the GBots in none.
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in contract/gbots.ts (the sub-headings), screens/sessions-screen/
 * GbotDepartmentView.tsx (the Department tab), apps/desktop/src/app/window/gbot_settings_modal/department.rs (the
 * desktop's same tab).
 */

export type GbotDepartmentMember = { botId: string; name: string; isLead: boolean };

export type GbotDepartment = {
  departmentId: string;
  name: string;
  instructions: string;
  /** Its lead's name, "" with none. */
  leadName: string;
  members: GbotDepartmentMember[];
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw : '';
}

/** The departments in their order; null when the answer is not a department list. */
export function parseGbotDepartments(json: unknown): GbotDepartment[] | null {
  const list = record(json).departments;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry): GbotDepartment[] => {
    const department = record(entry);
    const departmentId = text(department, 'departmentId');
    if (departmentId.length === 0) return [];
    const members = Array.isArray(department.members) ? department.members : [];
    return [
      {
        departmentId,
        name: text(department, 'name'),
        instructions: text(department, 'instructions'),
        leadName: text(record(department.lead), 'name'),
        members: members.flatMap((member): GbotDepartmentMember[] => {
          const bot = record(member);
          const botId = text(bot, 'botId');
          return botId.length === 0 ? [] : [{ botId, name: text(bot, 'name'), isLead: bot.isLead === true }];
        }),
      },
    ];
  });
}

/** A department's one-line summary: how many GBots, and who leads it. */
export function departmentDetail(department: GbotDepartment): string {
  const count = department.members.length;
  const bots = count === 1 ? '1 GBot' : `${count} GBots`;
  if (count === 0) return 'No GBots yet';
  return department.leadName.length > 0 ? `${bots}, led by ${department.leadName}` : `${bots}, no lead`;
}
