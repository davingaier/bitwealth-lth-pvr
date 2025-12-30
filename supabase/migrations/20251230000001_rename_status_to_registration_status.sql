-- Migration: Rename 'status' column to 'registration_status' to avoid confusion with 'customer_status'
-- Date: 2025-12-30
-- Reason: customer_details table has both 'status' (new MVP registration workflow) and 'customer_status' (legacy trading status)
--         Renaming to 'registration_status' makes the purpose clearer

-- Drop existing index on status column
DROP INDEX IF EXISTS public.idx_customer_details_status;

-- Rename the column
ALTER TABLE public.customer_details 
RENAME COLUMN status TO registration_status;

-- Recreate index with new column name
CREATE INDEX IF NOT EXISTS idx_customer_details_registration_status 
ON public.customer_details(registration_status);

-- Add comment to clarify purpose
COMMENT ON COLUMN public.customer_details.registration_status IS 
'Customer registration workflow status: prospect (submitted interest) → kyc (ID verified) → setup (account created) → active (funds deposited). Separate from customer_status which tracks legacy trading status.';
