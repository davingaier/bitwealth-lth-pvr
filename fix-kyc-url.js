// Temporary script to regenerate signed URL for customer 31
// Run with: node fix-kyc-url.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wqnmxpooabmedvtackji.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY_HERE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fixSignedUrl() {
  // Get customer 31's file path
  const { data: customer, error: fetchError } = await supabase
    .from('customer_details')
    .select('customer_id, kyc_id_document_url')
    .eq('customer_id', 31)
    .single();

  if (fetchError) {
    console.error('Error fetching customer:', fetchError);
    return;
  }

  console.log('Current URL:', customer.kyc_id_document_url);

  // Extract file path from public URL
  const filePath = '394eeed5-8918-4629-86c6-ad13b405734e/2026-01-01_Gaier_Jemaica_id.pdf';

  // Generate signed URL (1 year expiration)
  const { data: signedData, error: signedError } = await supabase.storage
    .from('kyc-documents')
    .createSignedUrl(filePath, 31536000);

  if (signedError) {
    console.error('Error creating signed URL:', signedError);
    return;
  }

  console.log('New signed URL:', signedData.signedUrl);

  // Update customer record
  const { error: updateError } = await supabase
    .from('customer_details')
    .update({ kyc_id_document_url: signedData.signedUrl })
    .eq('customer_id', 31);

  if (updateError) {
    console.error('Error updating customer:', updateError);
    return;
  }

  console.log('✅ Successfully updated customer 31 with signed URL');
}

fixSignedUrl();
