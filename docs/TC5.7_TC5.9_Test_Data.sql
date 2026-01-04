-- ============================================
-- TEST DATA FOR TC5.7, TC5.8, TC5.9
-- Customer Onboarding Test Cases
-- Date: 2026-01-04
-- ============================================

-- Get org_id from existing customer
DO $$
DECLARE
    v_org_id UUID;
    v_strategy_id UUID;
    v_customer_id_zero INT;
    v_customer_id_invalid INT;
    v_portfolio_id_zero UUID;
    v_portfolio_id_invalid UUID;
    v_exchange_account_id_zero UUID;
    v_exchange_account_id_invalid UUID;
BEGIN
    -- Get org_id and strategy_id
    SELECT org_id INTO v_org_id FROM customer_details WHERE customer_id = 31;
    SELECT strategy_id INTO v_strategy_id FROM strategies WHERE strategy_code = 'LTH_PVR';

    -- ============================================
    -- TC5.7: Customer with ZERO balance
    -- ============================================
    INSERT INTO customer_details (org_id, first_names, last_name, email, phone, registration_status)
    VALUES (v_org_id, 'TestZero', 'Balance', 'test.zero@example.com', '+27811111111', 'deposit')
    RETURNING customer_id INTO v_customer_id_zero;

    -- Create portfolio
    INSERT INTO customer_portfolios (org_id, customer_id, strategy_id, status, label)
    VALUES (v_org_id, v_customer_id_zero, v_strategy_id, 'pending', 'TestZero Balance - LTH PVR BTC DCA')
    RETURNING portfolio_id INTO v_portfolio_id_zero;

    -- Create exchange account with VALID subaccount but ZERO balance
    -- Use subaccount 1456357666877767680 (Jemaica Gaier) - assuming funds withdrawn to make it zero
    INSERT INTO exchange_accounts (exchange_account_id, org_id, exchange, subaccount_id, label, deposit_ref, status, is_omnibus)
    VALUES (gen_random_uuid(), v_org_id, 'VALR', '1456357666877767680', 'TestZero Balance LTH PVR', 'TESTZERO01', 'active', false)
    RETURNING exchange_account_id INTO v_exchange_account_id_zero;

    -- Link to portfolio
    UPDATE customer_portfolios 
    SET exchange_account_id = v_exchange_account_id_zero 
    WHERE portfolio_id = v_portfolio_id_zero;

    RAISE NOTICE 'TC5.7 Customer created: ID=%, Portfolio=%, ExchangeAccount=%', 
        v_customer_id_zero, v_portfolio_id_zero, v_exchange_account_id_zero;

    -- ============================================
    -- TC5.9: Customer with INVALID subaccount
    -- ============================================
    INSERT INTO customer_details (org_id, first_names, last_name, email, phone, registration_status)
    VALUES (v_org_id, 'TestInvalid', 'Subaccount', 'test.invalid@example.com', '+27822222222', 'deposit')
    RETURNING customer_id INTO v_customer_id_invalid;

    -- Create portfolio
    INSERT INTO customer_portfolios (org_id, customer_id, strategy_id, status, label)
    VALUES (v_org_id, v_customer_id_invalid, v_strategy_id, 'pending', 'TestInvalid Subaccount - LTH PVR BTC DCA')
    RETURNING portfolio_id INTO v_portfolio_id_invalid;

    -- Create exchange account with INVALID subaccount_id (non-existent)
    INSERT INTO exchange_accounts (exchange_account_id, org_id, exchange, subaccount_id, label, deposit_ref, status, is_omnibus)
    VALUES (gen_random_uuid(), v_org_id, 'VALR', '99999999999999', 'TestInvalid Subaccount LTH PVR', 'TESTINV01', 'active', false)
    RETURNING exchange_account_id INTO v_exchange_account_id_invalid;

    -- Link to portfolio
    UPDATE customer_portfolios 
    SET exchange_account_id = v_exchange_account_id_invalid 
    WHERE portfolio_id = v_portfolio_id_invalid;

    RAISE NOTICE 'TC5.9 Customer created: ID=%, Portfolio=%, ExchangeAccount=%', 
        v_customer_id_invalid, v_portfolio_id_invalid, v_exchange_account_id_invalid;

    RAISE NOTICE '';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Test data created successfully!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Customer 31 (Jemaica Gaier) = Active with balance (TC5.6 verified)';
    RAISE NOTICE 'Customer % (TestZero Balance) = Zero balance (TC5.7)', v_customer_id_zero;
    RAISE NOTICE 'Customer % (TestInvalid Subaccount) = Invalid subaccount (TC5.9)', v_customer_id_invalid;
    RAISE NOTICE 'Total customers in deposit status: 2';
    RAISE NOTICE '';
    RAISE NOTICE 'Next step: Run ef_deposit_scan via curl to test TC5.7, TC5.8, TC5.9';
END $$;

-- ============================================
-- VERIFY TEST DATA
-- ============================================
SELECT 
    cd.customer_id,
    cd.first_names || ' ' || cd.last_name AS name,
    cd.email,
    cd.registration_status,
    cp.portfolio_id,
    ea.subaccount_id,
    ea.deposit_ref
FROM customer_details cd
JOIN customer_portfolios cp ON cd.customer_id = cp.customer_id
JOIN exchange_accounts ea ON cp.exchange_account_id = ea.exchange_account_id
WHERE cd.registration_status = 'deposit'
ORDER BY cd.customer_id;
