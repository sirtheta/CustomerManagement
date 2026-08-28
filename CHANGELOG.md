# Changelog

## [1.2.2](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.2.1...customer-management-v1.2.2) (2026-08-28)


### Bug Fixes

* log of missint totp silent ([18d1466](https://github.com/sirtheta/CustomerManagement/commit/18d14666343857ca62cd9cd22d9bed90a39d2a72))
* migration failure ([24f307b](https://github.com/sirtheta/CustomerManagement/commit/24f307b0c7db40341af6982c5b75610da694b760))
* **pdf:** apply invoice discount ([76c1c85](https://github.com/sirtheta/CustomerManagement/commit/76c1c858a1b69ca6d6665c5581614ad1d4e9d599))
* **pdf:** prevent stale browser PDFs ([377f5cd](https://github.com/sirtheta/CustomerManagement/commit/377f5cd5e09a9e80e458de08d00a00cc69ddd876))

## [1.2.1](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.2.0...customer-management-v1.2.1) (2026-08-28)


### Bug Fixes

* **customers:** reset form state after cancel ([1f8e2e5](https://github.com/sirtheta/CustomerManagement/commit/1f8e2e503d07e23dd30ea7c53c3884cfe01461c5))
* **seed:** use test admin password ([791f389](https://github.com/sirtheta/CustomerManagement/commit/791f38991889e02b1bba8c5f012fddb615d75a0d))
* **test:** correct e2e login password and cross-platform PORT handling ([869f3bc](https://github.com/sirtheta/CustomerManagement/commit/869f3bc4a2ac19c56c1a16004af550813f67e14e))

## [1.2.0](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.1.1...customer-management-v1.2.0) (2026-08-27)


### Features

* **dashboard:** show scheduled invoices ([559843b](https://github.com/sirtheta/CustomerManagement/commit/559843be3ae093fac3d19bbc6c9cdb813f26a988))
* **invoices:** add percentage discounts ([afdedf6](https://github.com/sirtheta/CustomerManagement/commit/afdedf6e601da4bbbcb8a33491a04dee216a07df)), closes [#59](https://github.com/sirtheta/CustomerManagement/issues/59)
* **logs:** admin log export from the UI ([#40](https://github.com/sirtheta/CustomerManagement/issues/40)) ([e5a1e08](https://github.com/sirtheta/CustomerManagement/commit/e5a1e080172812f605ac0dfa2e5e5bfa850248bf))


### Bug Fixes

* **ci:** publish versioned image tags ([d56e7b3](https://github.com/sirtheta/CustomerManagement/commit/d56e7b3b47edf803deeeda94715aa8e75e6d1525))
* **dashboard:** limit scheduled customer query ([89487bf](https://github.com/sirtheta/CustomerManagement/commit/89487bf0c6619f3930214758eb35cbe4bf4ef507))
* **invoices:** log automatic email sends ([fc9a8df](https://github.com/sirtheta/CustomerManagement/commit/fc9a8dfa134f04b8b0a305fbb41974eb853d78b6))
* **layout:** use wider desktop content area ([93bf481](https://github.com/sirtheta/CustomerManagement/commit/93bf481d602d72b07a3e717b1f8111f6461c5bb5))
* **logs:** capture pino output instead of silently dropping it ([#42](https://github.com/sirtheta/CustomerManagement/issues/42)) ([024aaae](https://github.com/sirtheta/CustomerManagement/commit/024aaaee1d07562b0733ea895a5c313a8721c50a))
* **logs:** make path assertion portable ([eabd897](https://github.com/sirtheta/CustomerManagement/commit/eabd8978f54c302f0671bdab285600067d0fc081))

## [1.1.1](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.1.0...customer-management-v1.1.1) (2026-08-05)


### Bug Fixes

* **settings:** cache the GitHub release lookup independent of request-time APIs ([#30](https://github.com/sirtheta/CustomerManagement/issues/30)) ([d231055](https://github.com/sirtheta/CustomerManagement/commit/d231055d402ebb834b65424d1f1e099d1f0ac8e5))

## [1.1.0](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.0.1...customer-management-v1.1.0) (2026-08-04)


### Features

* **auth:** add self-service password reset and email-invite for new users ([4a4eddd](https://github.com/sirtheta/CustomerManagement/commit/4a4eddd90119a9a278a53f4ca12ccbc551d83871))
* **auth:** reject passwords found in known data breaches ([e189d2a](https://github.com/sirtheta/CustomerManagement/commit/e189d2a5078ad13f238bb88607855dbf4c8ee6b5))
* **invoices:** replace arrow-based item reordering with drag-and-drop ([95876df](https://github.com/sirtheta/CustomerManagement/commit/95876dfab73cd767f20c6d45b1c75e858d5af851))
* **marketing:** add lightbox, WordPress-hosted images, and Features proposal ([04d71b8](https://github.com/sirtheta/CustomerManagement/commit/04d71b8150c1f0ded4e43d5f7df0ced905348dd8))


### Bug Fixes

* **auth:** reject passwords longer than bcrypt's 72-byte limit ([29b954e](https://github.com/sirtheta/CustomerManagement/commit/29b954edca8ef35c775bedd0399fd81fadf690c4))
* **settings:** match release-please's component-prefixed tags in update check ([2400a1c](https://github.com/sirtheta/CustomerManagement/commit/2400a1c10e6c69a658a6d06c9bfcb817abd397af))
* **theme:** forward CSP nonce to next-themes' own script ([#29](https://github.com/sirtheta/CustomerManagement/issues/29)) ([d842b11](https://github.com/sirtheta/CustomerManagement/commit/d842b11e670603d26771644f7b232b04d50b6a66))

## [1.0.1](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.0.0...customer-management-v1.0.1) (2026-07-29)


### Bug Fixes

* **invoices,quotes:** use full page width on document detail pages ([8c71785](https://github.com/sirtheta/CustomerManagement/commit/8c71785cf27905ac380883e4fbaeeb17acf46780))
* **settings:** drop GitHub PAT requirement for update check ([56a7845](https://github.com/sirtheta/CustomerManagement/commit/56a7845cfd109ce43cee7f4db56407fb3b63d0d1))

## [1.0.0](https://github.com/sirtheta/CustomerManagement/compare/customer-management-v1.0.0...customer-management-v2.0.0) (2026-07-27)


### ⚠ BREAKING CHANGES

* drop CustomerManagement.web subfolder from CI, releases

### Miscellaneous Chores

* drop CustomerManagement.web subfolder from CI, releases ([0827e02](https://github.com/sirtheta/CustomerManagement/commit/0827e02aae604a1cdfbc1023d2a8e5e50c84012e))

## [0.1.23](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.22...web-v0.1.23) (2026-07-19)


### Features

* **settings:** allow a separate SMTP sender address ([#120](https://github.com/sirtheta/CustomerManagement/issues/120)) ([cf1b667](https://github.com/sirtheta/CustomerManagement/commit/cf1b667e54c6ce0e27f2117982f4eb2e52226a21))
* **web:** add Playwright e2e test setup ([#118](https://github.com/sirtheta/CustomerManagement/issues/118)) ([a0a3c19](https://github.com/sirtheta/CustomerManagement/commit/a0a3c192ca861b44a7934b04c60913fc09c34b3e))

## [0.1.22](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.21...web-v0.1.22) (2026-07-16)


### Bug Fixes

* **invoices,quotes:** stop delete dialog from hanging on FK errors ([#116](https://github.com/sirtheta/CustomerManagement/issues/116)) ([c08e035](https://github.com/sirtheta/CustomerManagement/commit/c08e0359f82ae424b370d86ffd4e97157a84b347))

## [0.1.21](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.20...web-v0.1.21) (2026-07-15)


### Features

* **invoices,quotes:** add searchable customer combobox ([a4e3a11](https://github.com/sirtheta/CustomerManagement/commit/a4e3a11c7e66f7289c3010b2e4dafcd707282640))
* **invoices,quotes:** add up/down buttons to reorder line items ([600dc6f](https://github.com/sirtheta/CustomerManagement/commit/600dc6f4245ef4cfe434c7de13c75b82c1078e01))


### Bug Fixes

* **pdf:** bump document version on edit to bust stale PDF cache ([d98cbff](https://github.com/sirtheta/CustomerManagement/commit/d98cbffc611059e021ea9c0998ace4969c2dfe81))

## [0.1.20](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.19...web-v0.1.20) (2026-06-27)


### Features

* **accounting:** add visual profit/loss chart to accounting page ([#87](https://github.com/sirtheta/CustomerManagement/issues/87)) ([9c39307](https://github.com/sirtheta/CustomerManagement/commit/9c393077fb411b90077094b390faa07fae920751))


### Bug Fixes

* **invoices:** allow decimal quantities and prices in line item editor ([#88](https://github.com/sirtheta/CustomerManagement/issues/88)) ([04bbada](https://github.com/sirtheta/CustomerManagement/commit/04bbada80c072bf40b1e72d070b76a2544338df2))

## [0.1.19](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.18...web-v0.1.19) (2026-06-25)


### Bug Fixes

* **analytics:** fix legend colors and icon size in combined category chart ([59c4f9b](https://github.com/sirtheta/CustomerManagement/commit/59c4f9beb857bf1ab5adccd0257d53c3e0534f61))

## [0.1.18](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.17...web-v0.1.18) (2026-06-24)


### Features

* **analytics:** show combined income+expense totals per category] ([#81](https://github.com/sirtheta/CustomerManagement/issues/81)) ([bc7283b](https://github.com/sirtheta/CustomerManagement/commit/bc7283b5cd46c03f69af53973f8fd47aa467dc8c))

## [0.1.17](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.16...web-v0.1.17) (2026-06-22)


### Features

* **analytics:** show income/expenses by category instead of invoice… ([#78](https://github.com/sirtheta/CustomerManagement/issues/78)) ([181c500](https://github.com/sirtheta/CustomerManagement/commit/181c5002012a1a77cfd56bf948b6363687922af2))

## [0.1.16](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.15...web-v0.1.16) (2026-06-21)


### Features

* PDF theme designer, quote PDFs + email sending ([5935d96](https://github.com/sirtheta/CustomerManagement/commit/5935d969c8a8c35402eb4ad3cca3ec880b68f96e))
* **pdf:** add customizable PDF theme designer with live preview ([8ace106](https://github.com/sirtheta/CustomerManagement/commit/8ace10676a4fd61278f88efa01158639e74b3ef5))
* **quotes:** add email sending with PDF and send history ([7c7a0bd](https://github.com/sirtheta/CustomerManagement/commit/7c7a0bd5fcd63fabe98378852b844a680e8c713a))
* **web:** show version status card in settings ([251df8d](https://github.com/sirtheta/CustomerManagement/commit/251df8d647ae1a226c84c39b800c5364c0ea1b97))


### Bug Fixes

* **pdf:** fall back to Helvetica on font load failure; guard send recipient ([927739d](https://github.com/sirtheta/CustomerManagement/commit/927739df54e2d397151878a094a913a5b6e5e76c))
* **web:** authenticate update-check requests to GitHub API ([4974955](https://github.com/sirtheta/CustomerManagement/commit/4974955de2ed5fef17f6499f32afcd24992f7442))
* **web:** authenticate update-check requests to GitHub API ([50811a1](https://github.com/sirtheta/CustomerManagement/commit/50811a1c406da1547fe0c3950a4e6c02148e51a2))

## [0.1.15](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.14...web-v0.1.15) (2026-06-20)


### Features

* **accounting:** add cash-basis income/expense bookkeeping module ([#73](https://github.com/sirtheta/CustomerManagement/issues/73)) ([bfb2574](https://github.com/sirtheta/CustomerManagement/commit/bfb25747ef7f7204f4a91626f29bfaa10af844ab))

## [0.1.14](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.13...web-v0.1.14) (2026-06-19)


### Features

* **customers:** add encrypted notes section per customer ([31d21cd](https://github.com/sirtheta/CustomerManagement/commit/31d21cdf89db52678131cbedf96704fb134ec3f3))


### Bug Fixes

* **auth:** extend session to 7 days with sliding refresh ([#57](https://github.com/sirtheta/CustomerManagement/issues/57)) ([21db14f](https://github.com/sirtheta/CustomerManagement/commit/21db14f8fee7e35cc7b5f0abccd8f13384b2151b))
* **docker:** stop Next's SIGTERM handler from racing the DB shutdown ([e72aa97](https://github.com/sirtheta/CustomerManagement/commit/e72aa97d1777b47059bd966e63f3039f95701634))

## [0.1.13](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.12...web-v0.1.13) (2026-06-15)


### Features

* **analytics:** add drilldown drawer for invoice details ([#50](https://github.com/sirtheta/CustomerManagement/issues/50)) ([6428ad4](https://github.com/sirtheta/CustomerManagement/commit/6428ad4b48690029213e93eb08883f06aab443be))

## [0.1.12](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.11...web-v0.1.12) (2026-06-13)


### Features

* add calendar picker for dates ([0b09a14](https://github.com/sirtheta/CustomerManagement/commit/0b09a14367cbd25a84a69eb019a35f1463c9119a))
* **customers:** two-column layout on customer detail page ([d9a292b](https://github.com/sirtheta/CustomerManagement/commit/d9a292b2531d0532c6d69427d5e6ce6803b3b3a9))
* **settings:** two-column layout on desktop ([da3a375](https://github.com/sirtheta/CustomerManagement/commit/da3a3756365b2e137cbbb0af53693d005d721535))


### Bug Fixes

* **audit:** log audit-write failures instead of swallowing them ([851b6af](https://github.com/sirtheta/CustomerManagement/commit/851b6af9ed6f425ecb0e03127a6974c80aa80cfb))
* **customers:** move Bearbeiten into card and add Neue Offerte button ([0b1b7e9](https://github.com/sirtheta/CustomerManagement/commit/0b1b7e938aa81d411bfd86a250f1803650d50618))
* **customers:** scope detail "show all" links by customerId ([bcd90c1](https://github.com/sirtheta/CustomerManagement/commit/bcd90c12c8776f4d618e8eb40aa5ff0f1e27576b))
* **customers:** stay on customer detail after save ([2dcd86f](https://github.com/sirtheta/CustomerManagement/commit/2dcd86fe31091ac23792c8e377b2b53febb0a14d))
* **invoices,quotes:** cancel/save in edit returns to document view ([af4bdcc](https://github.com/sirtheta/CustomerManagement/commit/af4bdcc0b08220a764c5f82679dceaa687943ddd))
* **invoices,quotes:** preserve customer origin through edit ([344b69a](https://github.com/sirtheta/CustomerManagement/commit/344b69a90a35ff373356649bbcf1f05e9c08171b))
* **invoices:** preserve customer context through edit flow ([842a5f9](https://github.com/sirtheta/CustomerManagement/commit/842a5f9c22d228ab25b5621e4badeb471de21761))
* **quotes:** preserve customer context through edit flow ([d25c885](https://github.com/sirtheta/CustomerManagement/commit/d25c885a8b9b4173b83311e118998db98f1a282e))
* remove nativ button warning ([2ff5ae5](https://github.com/sirtheta/CustomerManagement/commit/2ff5ae5550c6f53161ace94b0f2010be14e7483c))


### Performance Improvements

* **customers:** bound invoice/quote lists on detail page ([9931da3](https://github.com/sirtheta/CustomerManagement/commit/9931da37480f4400f92412104fdef5aca9ae188f))
* **db:** index Item.invoiceId/quoteId and Document.customerId ([eea4d18](https://github.com/sirtheta/CustomerManagement/commit/eea4d18befbca0789101557eaf35e8a7abd71c10))
* **layout:** drop per-request state checks already run by cron ([aa30698](https://github.com/sirtheta/CustomerManagement/commit/aa306984eb88aa07576c98f340dce893047354ed))

## [0.1.11](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.10...web-v0.1.11) (2026-06-12)


### Features

* add notification intervall settings ([80e1444](https://github.com/sirtheta/CustomerManagement/commit/80e14447659e85305dc725b023a651224606799a))
* **cache:** replace in-memory PDF cache with disk-based cache ([ba30061](https://github.com/sirtheta/CustomerManagement/commit/ba3006102574507f5e3a4174330f78ca416e0cd9))
* **config:** centralize magic numbers in lib/config.ts ([84972d3](https://github.com/sirtheta/CustomerManagement/commit/84972d3e762444130f8b87de3b60396135114d81))
* **logging:** add server-side error logging and try/catch to actions ([47953e6](https://github.com/sirtheta/CustomerManagement/commit/47953e6fe2c99dd58304f5898daaa8200cac3b47))
* **notifications:** add daily email and Telegram notifications for overdue invoices and pending reviews ([cc02adf](https://github.com/sirtheta/CustomerManagement/commit/cc02adf7861ec6960ce80230658bd16b12514292))
* **notifications:** add daily email and Telegram notifications for overdue invoices and pending reviews ([0b3a263](https://github.com/sirtheta/CustomerManagement/commit/0b3a2634301b239d548f8367f44bdb3c5bd20ea1))
* **security:** add CSP/HSTS headers and self-service password change ([64a571b](https://github.com/sirtheta/CustomerManagement/commit/64a571b64fd0ff24f70922a4d234d7b55dafb2f8))
* **security:** encrypt secrets at rest and hash TOTP backup codes ([0e877b4](https://github.com/sirtheta/CustomerManagement/commit/0e877b4ce93c93cc895ef7c3621c524d6f5cd7c0))
* **security:** nonce-based CSP and consolidate file/password helpers ([47cb3cd](https://github.com/sirtheta/CustomerManagement/commit/47cb3cd5535ff70964bb3cd9e5c2e8f9347784d5))
* **test-env:** add Docker test environment with email suppression and nightly reset ([#41](https://github.com/sirtheta/CustomerManagement/issues/41)) ([cc8095a](https://github.com/sirtheta/CustomerManagement/commit/cc8095ab027d4f87a02f282d9540a6843583274b))
* **ux:** add field-level validation errors and aria attributes to forms ([4714ecd](https://github.com/sirtheta/CustomerManagement/commit/4714ecd02de25f81704e44452c20ffd5b104983f))
* **ux:** add skeleton loaders for customer and invoice tables ([b4681ad](https://github.com/sirtheta/CustomerManagement/commit/b4681ad2ebec2ac31a8a8be13f83c3c65e3eaa4a))


### Bug Fixes

* **api:** standardize all API route errors to JSON format ([7aabae2](https://github.com/sirtheta/CustomerManagement/commit/7aabae2e6b4096d186beefa62210b0d460601557))
* **api:** validate export query params with Zod enum schemas ([2262fde](https://github.com/sirtheta/CustomerManagement/commit/2262fde2a29eccb531d88970ff219da1036184bf))
* **api:** validate upload content and stop serving SVG/active content ([eddfc57](https://github.com/sirtheta/CustomerManagement/commit/eddfc578e07de763e89fd2201b5bc76f52d4a42e))
* **audit:** log user management mutations ([6c62ab8](https://github.com/sirtheta/CustomerManagement/commit/6c62ab8eb492d4b333077e4a5c34a5d0dae65f88))
* **auth:** harden login against enumeration, brute force and races ([8bf6df7](https://github.com/sirtheta/CustomerManagement/commit/8bf6df7fd2d618f861b47d749fb381dc03294b87))
* **auth:** harden login against enumeration, brute force and races ([a61cb9c](https://github.com/sirtheta/CustomerManagement/commit/a61cb9ca1ea3cba3b77266d9808048167a99b495))
* **auth:** stop double-counting the login rate limit ([f38626f](https://github.com/sirtheta/CustomerManagement/commit/f38626f4ed61e46501f7699dc15ff885c69dddac))
* **db:** add indexes for frequently queried fields ([ef33f6b](https://github.com/sirtheta/CustomerManagement/commit/ef33f6b4e869f95a4914a6c693dc687e770a3e87))
* **error-handling:** add Next.js error boundaries and fix raw throws ([7aafa38](https://github.com/sirtheta/CustomerManagement/commit/7aafa38fa022ce2f969de479486e2b6f25e50d95))
* make sure to flush pending writes to db on SIGTERM ([91f29f5](https://github.com/sirtheta/CustomerManagement/commit/91f29f5aa10d3b69c5e5e70ef49d153ba1f2a953))
* **notifications:** suppress notifications in test environment and fix post-merge issues ([915172e](https://github.com/sirtheta/CustomerManagement/commit/915172ec1d317c08a92e89e260a259af1bb406f1))
* **notifications:** use shared Prisma client in cron and stamp notified records by ID ([10ed90d](https://github.com/sirtheta/CustomerManagement/commit/10ed90d791423b94f2fcb60252361eda7da447c6))
* password changes for own user only in profile ([32308a2](https://github.com/sirtheta/CustomerManagement/commit/32308a2d10ee2f62ddc721b681c796452b30f5ad))
* **security:** add role-based authorization to document download route ([0ee164f](https://github.com/sirtheta/CustomerManagement/commit/0ee164ffce8fe31082a9502df590e4a7f0d06e17))
* **security:** generate random initial admin password instead of default ([158a9b2](https://github.com/sirtheta/CustomerManagement/commit/158a9b274a5b99b48360f209645cf25e51aecfa7))
* **validation:** reject negative and out-of-range numeric inputs ([ef3fe8c](https://github.com/sirtheta/CustomerManagement/commit/ef3fe8cfd29d590f8b8d9db24b2980756aba9783))

## [0.1.10](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.9...web-v0.1.10) (2026-06-10)


### Features

* **search:** add live results preview dropdown to global search ([#39](https://github.com/sirtheta/CustomerManagement/issues/39)) ([d7cfeda](https://github.com/sirtheta/CustomerManagement/commit/d7cfeda5a05298aab1cb5cf4ef37f499229a3915))
* Update notification added for admin ([#37](https://github.com/sirtheta/CustomerManagement/issues/37)) ([f634c8a](https://github.com/sirtheta/CustomerManagement/commit/f634c8abd2c6a5ccd0de255e31f1e281b81e2cf0))


### Bug Fixes

* change totp to 2FA ([0dc0d2b](https://github.com/sirtheta/CustomerManagement/commit/0dc0d2b0d42bc45f9d5241ba291dac35f2041ac0))
* **invoices:** show item description on mobile detail view ([#40](https://github.com/sirtheta/CustomerManagement/issues/40)) ([ea0eca2](https://github.com/sirtheta/CustomerManagement/commit/ea0eca2e2ea00bf04334c370754d43febbb3a8ec))

## [0.1.9](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.8...web-v0.1.9) (2026-06-09)


### Bug Fixes

* do not delete last admin guard ([c40a815](https://github.com/sirtheta/CustomerManagement/commit/c40a815b30e812929c0a0962984bdb68a7ffd5d0))

## [0.1.8](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.7...web-v0.1.8) (2026-06-08)


### Features

* add logging ([4657134](https://github.com/sirtheta/CustomerManagement/commit/4657134b2ca7a279dc6e33ff2e95bbb6b830c969))
* removed button "Details" invoice and quotes directly with link accessible ([67ba17f](https://github.com/sirtheta/CustomerManagement/commit/67ba17fd4c26e5f2a6986fb0246c0b64d9f2a7d7))
* server-side pagination and sortable columns for all list views ([#14](https://github.com/sirtheta/CustomerManagement/issues/14)) ([2cf0fd0](https://github.com/sirtheta/CustomerManagement/commit/2cf0fd05b64c128d3d2d9d32c1a449106d9aeb0c))


### Bug Fixes

* at least one admin user must be active ([2db11e9](https://github.com/sirtheta/CustomerManagement/commit/2db11e90e9faf0382d9b2cc7d4dc796fec1b46cd))
* breadcrumbs ([79ef43f](https://github.com/sirtheta/CustomerManagement/commit/79ef43f4f7ea5432ca18edb06911dab3a5a434b8))
* db migration ([d207f23](https://github.com/sirtheta/CustomerManagement/commit/d207f23da97be90459764be29426d9438f26a7e0))
* increases text area for service input ([0cbb223](https://github.com/sirtheta/CustomerManagement/commit/0cbb223e860e0346addfaf40baa111e78754f958))
* invoice and woutes link in customer view ([51b2d4d](https://github.com/sirtheta/CustomerManagement/commit/51b2d4d3a779a8c604e576a6108ae5002bbafeec))
* no autofill for search fields ([f571977](https://github.com/sirtheta/CustomerManagement/commit/f5719778922ae44b1cbee9e7119d6c82cc437572))
* usermanagement ([c16313a](https://github.com/sirtheta/CustomerManagement/commit/c16313a9c3fba9ceffbd610af5975a18c63aad61))

## [0.1.7](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.6...web-v0.1.7) (2026-06-07)


### Features

* add testbutton for smtp settings ([b6dabed](https://github.com/sirtheta/CustomerManagement/commit/b6dabed834ee07d3edd2b71f3b32844b10554dce))
* implements search for all kind of things... ([cf0a9a7](https://github.com/sirtheta/CustomerManagement/commit/cf0a9a7a98e9cd63e538de40ff20b7f3fe85d2fd))


### Bug Fixes

* input on mobile for services improved ([8ea6dd2](https://github.com/sirtheta/CustomerManagement/commit/8ea6dd250816ad04dba4d48ed58d0f7c4e7a15b7))
* mobile editing and saving of invoices ([4d37c86](https://github.com/sirtheta/CustomerManagement/commit/4d37c86f18c163627106779986e9e0242ea65ac2))
* use crypto module for random totp secret backup codes ([1bdd57f](https://github.com/sirtheta/CustomerManagement/commit/1bdd57f4ffbf423558bbfb4c062de324576eb38b))

## [0.1.6](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.5...web-v0.1.6) (2026-06-07)


### Features

* auto check for yearly invoice ([66d572b](https://github.com/sirtheta/CustomerManagement/commit/66d572b98a300fbe87fe22392f910982578d2725))
* customer view with invoices ([6cc0060](https://github.com/sirtheta/CustomerManagement/commit/6cc006008f5220a06ce959db90ecf7945581c578))
* email sending in app ([1811cbf](https://github.com/sirtheta/CustomerManagement/commit/1811cbf08aad49c7fab40f39103fc3fab2471803))
* eye/eye off for password field, deactivate autofill on totp code input ([0d915ab](https://github.com/sirtheta/CustomerManagement/commit/0d915abda2c1fb8010ccc9b30eb9607fbfbb8bb2))


### Bug Fixes

* show toast on password change and generate totp backup codes ([73c3cf8](https://github.com/sirtheta/CustomerManagement/commit/73c3cf89fb8d85cd5c30614f3f79ef4723fa5c74))

## [0.1.5](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.4...web-v0.1.5) (2026-06-07)


### Bug Fixes

* DB seed ([19b9edd](https://github.com/sirtheta/CustomerManagement/commit/19b9edd62d7ef502ae50902b30fa37a56c0db07e))
* initial DB seed ([9152ca3](https://github.com/sirtheta/CustomerManagement/commit/9152ca323875aed0f9383bd545291b915dadb938))

## [0.1.4](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.3...web-v0.1.4) (2026-06-07)


### Bug Fixes

* move shadcn to devDependencies and fix standalone copy layers ([cf9cd62](https://github.com/sirtheta/CustomerManagement/commit/cf9cd62cae3788688f8fb26462984494f9ab0a7d))
* package size optimized ([142e3e0](https://github.com/sirtheta/CustomerManagement/commit/142e3e0c5d5867f80c5827638529cd21907e1d0d))

## [0.1.3](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.2...web-v0.1.3) (2026-06-06)


### Features

* add version of app to footer ([7e4e99b](https://github.com/sirtheta/CustomerManagement/commit/7e4e99bdcd7872940cb838e82b15883f86229488))

## [0.1.2](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.1...web-v0.1.2) (2026-06-06)


### Bug Fixes

* display of customer name if no company is set ([4f3967b](https://github.com/sirtheta/CustomerManagement/commit/4f3967b661711d214a740e9d510be87de258c6df))
* proper migration from .net db ([bf88987](https://github.com/sirtheta/CustomerManagement/commit/bf88987110e513b53f3f68ad7154eba8cc82787a))

## [0.1.1](https://github.com/sirtheta/CustomerManagement/compare/web-v0.1.0...web-v0.1.1) (2026-06-06)


### Bug Fixes

* add node-addon-api to devDependencies for sharp source build on ARM64 ([#3](https://github.com/sirtheta/CustomerManagement/issues/3)) ([f3e6068](https://github.com/sirtheta/CustomerManagement/commit/f3e60688d63edd9efadd7a94a47c813d66b3b092))
