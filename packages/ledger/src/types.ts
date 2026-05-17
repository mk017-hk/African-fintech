import type { Money } from '@afristable/shared';
import type { NormalSide } from '@afristable/database';

/** A single leg of a double-entry posting. */
export interface PostingLeg {
  accountId: string;
  side: NormalSide;
  amount: Money;
  memo?: string;
}

/**
 * A transfer is a set of legs that must sum to zero per currency.
 * Posting is atomic: either all legs are written, or none.
 */
export interface Posting {
  transferId: string;            // caller-supplied (idempotent) or generated
  legs: PostingLeg[];
  transactionId?: string;        // backlink to business-level Transaction
  memo?: string;
}

export interface AccountBalance {
  accountId: string;
  currency: string;
  /** Sum of CREDIT − DEBIT for credit-normal accounts; inverse for debit-normal. */
  balance: Money;
}
