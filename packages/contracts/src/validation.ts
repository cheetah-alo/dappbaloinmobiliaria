import { z } from 'zod';
import {
  attributionSources,
  priceVisibilities,
  propertyAvailabilityStatuses,
  propertyImageCategories,
  propertyOperations,
} from './index';

const identifierSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,120}$/);
const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const moneySchema = z.object({
  currency: z.enum(['PEN', 'USD']),
  amount: z.number().finite().positive().max(100_000_000),
});

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

export const propertyDraftSchema = z.object({
  expectedVersion: z.number().int().min(0),
  slug: slugSchema,
  label: z.string().trim().min(3).max(160),
  assigneeId: identifierSchema,
  title: z.string().trim().min(8).max(180),
  operation: z.enum(propertyOperations),
  district: z.string().trim().min(2).max(120),
  zone: z.string().trim().min(2).max(120).optional(),
  builtAreaM2: z.number().finite().positive().max(100_000),
  totalAreaM2: z.number().finite().positive().max(100_000).optional(),
  bedrooms: z.number().int().min(0).max(50),
  bathrooms: z.number().int().min(0).max(50),
  parking: z.number().int().min(0).max(50),
  studies: z.number().int().min(0).max(20),
  summary: z.string().trim().min(40).max(1_200),
  features: z.array(z.string().trim().min(2).max(120)).max(30),
  priceVisibility: z.enum(priceVisibilities).default('consult'),
  askingPrice: moneySchema.optional(),
  sourceUrl: z.string().url().max(2_048).optional(),
  instagramUrl: z.string().url().max(2_048).optional(),
  postId: z.string().trim().min(1).max(120).optional(),
  privateDetails: z.object({
    exactAddress: z.string().trim().min(3).max(300).optional(),
    ownerReference: z.string().trim().min(1).max(300).optional(),
    documentNotes: z.string().trim().min(1).max(2_000).optional(),
    negotiationNotes: z.string().trim().min(1).max(2_000).optional(),
  }),
}).superRefine((value, context) => {
  if (value.priceVisibility === 'public' && !value.askingPrice) {
    context.addIssue({ code: 'custom', path: ['askingPrice'], message: 'public_price_requires_amount' });
  }
  if (value.totalAreaM2 !== undefined && value.totalAreaM2 < value.builtAreaM2) {
    context.addIssue({ code: 'custom', path: ['totalAreaM2'], message: 'total_area_must_cover_built_area' });
  }
});

export const propertyMediaIntentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  revisionId: identifierSchema,
  files: z.array(z.object({
    category: z.enum(propertyImageCategories),
    alt: z.string().trim().min(3).max(180),
    sortOrder: z.number().int().min(0).max(29),
    isCover: z.boolean(),
    sizeBytes: z.number().int().positive().max(12 * 1024 * 1024),
    mimeType: z.literal('image/webp'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(30),
});

export const propertyMediaCompleteSchema = z.object({
  uploadToken: z.string().min(32).max(2_048),
  thumbnailUploadToken: z.string().min(32).max(2_048),
  revisionId: identifierSchema,
  category: z.enum(propertyImageCategories),
  alt: z.string().trim().min(3).max(180),
  sortOrder: z.number().int().min(0).max(29),
  isCover: z.boolean(),
  width: z.number().int().min(320).max(2_400),
  height: z.number().int().min(240).max(2_400),
  sizeBytes: z.number().int().positive().max(12 * 1024 * 1024),
  mimeType: z.literal('image/webp'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const propertyAvailabilitySchema = z.object({
  availabilityStatus: z.enum(propertyAvailabilityStatuses),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
});
