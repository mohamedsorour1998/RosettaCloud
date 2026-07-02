import { problemMessage, problemCode, problemPayload } from './problem-detail';

describe('problem-detail helpers', () => {
  describe('RFC7807 (Java problem+json) shapes', () => {
    const quota403 = {
      status: 403,
      statusText: 'Forbidden',
      error: {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'Weekly AI message quota exhausted.',
        code: 'AI_QUOTA_EXHAUSTED',
        payload: {
          messages_used: 5,
          messages_remaining: 0,
          messages_limit: 5,
          week_resets_at: 1750000000,
        },
      },
    };

    it('problemMessage returns the human detail string', () => {
      expect(problemMessage(quota403)).toBe('Weekly AI message quota exhausted.');
    });

    it('problemCode returns the top-level code', () => {
      expect(problemCode(quota403)).toBe('AI_QUOTA_EXHAUSTED');
    });

    it('problemPayload returns the top-level payload', () => {
      expect(problemPayload<{ messages_limit: number }>(quota403)?.messages_limit).toBe(5);
    });

    it('joins validation errors and exposes VALIDATION_ERROR', () => {
      const err = {
        status: 400,
        statusText: 'Bad Request',
        error: {
          title: 'Bad Request',
          status: 400,
          code: 'VALIDATION_ERROR',
          errors: { pod_name: 'must not be blank', name: 'is required' },
        },
      };
      expect(problemMessage(err)).toContain('must not be blank');
      expect(problemMessage(err)).toContain('is required');
      expect(problemCode(err)).toBe('VALIDATION_ERROR');
    });

    it('falls back to title / status for bare 404 and 500', () => {
      expect(
        problemMessage({ status: 404, statusText: 'Not Found', error: { title: 'Not Found', status: 404 } })
      ).toBe('Not Found');
      expect(problemMessage({ status: 500, statusText: 'Server Error', error: null })).toContain('500');
    });
  });

  describe('legacy FastAPI shapes (dual-run tolerance)', () => {
    it('parses the nested detail.code / detail.quota object', () => {
      const err = {
        status: 403,
        statusText: 'Forbidden',
        error: {
          detail: {
            code: 'AI_QUOTA_EXHAUSTED',
            message: 'No messages remaining',
            quota: { messages_used: 3, messages_remaining: 0, messages_limit: 3, week_resets_at: 0 },
          },
        },
      };
      expect(problemCode(err)).toBe('AI_QUOTA_EXHAUSTED');
      expect(problemPayload<{ messages_limit: number }>(err)?.messages_limit).toBe(3);
      expect(problemMessage(err)).toBe('No messages remaining');
    });

    it('returns a plain string detail', () => {
      expect(
        problemMessage({ status: 400, statusText: 'Bad Request', error: { detail: 'bad thing happened' } })
      ).toBe('bad thing happened');
    });

    it('returns a plain string error body', () => {
      expect(problemMessage({ status: 400, statusText: 'x', error: 'plain text error' })).toBe('plain text error');
    });

    it('has no code / payload for shapeless errors', () => {
      expect(problemCode({ status: 500, error: null })).toBeUndefined();
      expect(problemPayload({ status: 500, error: 'oops' })).toBeUndefined();
    });
  });
});
