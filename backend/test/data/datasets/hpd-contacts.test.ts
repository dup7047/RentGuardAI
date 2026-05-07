import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHpdContacts } from '../../../src/data/datasets/hpd-contacts.js';

afterEach(() => vi.restoreAllMocks());

const REG_ID = '12345';
const MOCK_CONTACT = {
  registrationcontactid: 'C1',
  registrationid: REG_ID,
  type: 'HeadOfficer',
  firstname: 'John',
  lastname: 'Doe',
};

describe('getHpdContacts', () => {
  it('happy path: returns contacts array', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK_CONTACT]), { status: 200 }),
    );
    const rows = await getHpdContacts(REG_ID);
    expect(rows[0]?.registrationcontactid).toBe('C1');
    expect(rows[0]?.type).toBe('HeadOfficer');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getHpdContacts(REG_ID)).toEqual([]);
  });

  it('is not cached (always calls fetch)', async () => {
    const spy = vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify([MOCK_CONTACT]), { status: 200 }),
    );
    await getHpdContacts(REG_ID);
    await getHpdContacts(REG_ID);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
