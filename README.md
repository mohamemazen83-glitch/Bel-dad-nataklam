# بالضاد نتكلم

تطبيق Android لكورس اللغة العربية: محاضرات صوتية وملفات PDF، اختبارات اختيار من متعدد وأسئلة مقالية، إشعارات، ومتابعة الطلاب. اللون الأساسي بني.

## الإعداد
1. نفّذ `backend/supabase-setup.sql` كاملًا في Supabase → SQL Editor (ينشئ الجداول والسياسات والتخزين ومحتوى تجريبيًا).
2. ضع Project URL والمفتاح العام `sb_publishable_...` في `app/src/main/assets/config.js`.
3. أنشئ حسابًا من التطبيق ثم اجعله مشرفًا:
   `insert into public.lecture_admins (user_id) select id from auth.users where email = 'بريدك';`
4. ارفع المشروع على GitHub: ملف `.github/workflows/build-apk.yml` يبني الـ APK تلقائيًا ويضعه في Releases.

لا تضع `service_role` أبدًا داخل التطبيق.
