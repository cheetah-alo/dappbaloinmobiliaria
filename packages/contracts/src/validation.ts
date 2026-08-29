import { z } from 'zod';
import { attributionSources } from './index';

export const attributionSchema = z.object({
  source: z.enum(attributionSources),
  utmSource: z.string().trim().min(1).max(120).optional(),
  utmCampaign: z.string().trim().min(1).max(120).optional(),
  qrId: z.string().trim().min(1).max(120).optional(),
  postId: z.string().trim().min(1).max(120).optional(),
});

export const ownerEnquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(40).refine((value) => value.replace(/\D/g, '').length >= 7, 'invalid_phone'),
  email: z.string().trim().email().max(254).optional(),
  operation: z.enum(['sell', 'rent', 'buy', 'invest']),
  district: z.string().trim().min(2).max(120),
  consent: z.literal(true),
  attribution: attributionSchema,
});
