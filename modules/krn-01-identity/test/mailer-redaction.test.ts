import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevLogMailer } from '../src/mailer';
afterEach(()=>vi.restoreAllMocks());
describe('development mail log redaction',()=>{it('does not log message bodies containing one-time codes',async()=>{const log=vi.spyOn(console,'info').mockImplementation(()=>undefined);await new DevLogMailer().send({to:'person@example.com',subject:'Sign-in code',text:'Your code is 123456'});expect(log).toHaveBeenCalledOnce();expect(log.mock.calls.flat().join(' ')).not.toContain('123456');});});