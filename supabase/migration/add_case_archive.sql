CREATE TABLE IF NOT EXISTS public.refund_case_images (
 corp_id text NOT NULL,emp_id text NOT NULL,image_id text NOT NULL,data_url text NOT NULL,receipt text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(corp_id,emp_id,image_id)
);
ALTER TABLE public.refund_case_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_image_owner ON public.refund_case_images;
CREATE POLICY refund_image_owner ON public.refund_case_images FOR ALL TO authenticated
USING(corp_id=auth.jwt()->'user_metadata'->>'corp_id' AND emp_id=auth.jwt()->'user_metadata'->>'emp_id')
WITH CHECK(corp_id=auth.jwt()->'user_metadata'->>'corp_id' AND emp_id=auth.jwt()->'user_metadata'->>'emp_id');
GRANT SELECT,INSERT ON public.refund_case_images TO authenticated;
CREATE TABLE IF NOT EXISTS public.refund_case_archive (
  corp_id text NOT NULL,
  emp_id text NOT NULL,
  case_id uuid NOT NULL,
  case_data jsonb,
  images jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corp_id,emp_id,case_id)
);
ALTER TABLE public.refund_case_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_case_owner ON public.refund_case_archive;
CREATE POLICY refund_case_owner ON public.refund_case_archive FOR ALL TO authenticated
USING (corp_id=auth.jwt()->'user_metadata'->>'corp_id' AND emp_id=auth.jwt()->'user_metadata'->>'emp_id')
WITH CHECK (corp_id=auth.jwt()->'user_metadata'->>'corp_id' AND emp_id=auth.jwt()->'user_metadata'->>'emp_id');
GRANT SELECT,INSERT,UPDATE ON public.refund_case_archive TO authenticated;

CREATE OR REPLACE FUNCTION public.save_refund_case(p_case_id uuid,p_case_data jsonb,p_images jsonb,p_receipt text,p_previous_receipt text,p_deleted boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c text:=auth.jwt()->'user_metadata'->>'corp_id'; e text:=auth.jwt()->'user_metadata'->>'emp_id'; current_row public.refund_case_archive%ROWTYPE; old_revision jsonb;
BEGIN
 IF c IS NULL OR e IS NULL OR c='' OR e='' THEN RAISE EXCEPTION 'Authenticated employee required'; END IF;
 INSERT INTO public.refund_case_archive(corp_id,emp_id,case_id,case_data,images,receipt,deleted)
 VALUES(c,e,p_case_id,p_case_data,p_images,p_receipt,p_deleted) ON CONFLICT DO NOTHING;
 SELECT * INTO current_row FROM public.refund_case_archive WHERE corp_id=c AND emp_id=e AND case_id=p_case_id FOR UPDATE;
 IF current_row.receipt=p_receipt THEN RETURN p_receipt; END IF;
 IF current_row.receipt IS DISTINCT FROM p_previous_receipt THEN RAISE EXCEPTION 'CASE_CONFLICT'; END IF;
 IF NOT p_deleted AND current_row.case_data IS NOT NULL THEN
  FOR old_revision IN SELECT value FROM jsonb_array_elements(current_row.case_data->'revisions') LOOP
   IF NOT (p_case_data->'revisions' @> jsonb_build_array(old_revision)) THEN RAISE EXCEPTION 'Historical revisions are immutable'; END IF;
  END LOOP;
 END IF;
 UPDATE public.refund_case_archive SET case_data=p_case_data,images=p_images,receipt=p_receipt,deleted=p_deleted,updated_at=now() WHERE corp_id=c AND emp_id=e AND case_id=p_case_id;
 RETURN p_receipt;
END $$;
REVOKE ALL ON FUNCTION public.save_refund_case(uuid,jsonb,jsonb,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_refund_case(uuid,jsonb,jsonb,text,text,boolean) TO authenticated;
