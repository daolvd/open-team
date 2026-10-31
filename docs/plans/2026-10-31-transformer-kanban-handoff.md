# Process song song và Kanban — plan chung Codex / Claude

Ngày tạo: 2026-10-31. Repo: OpenMausBot-main / open-team. HEAD ban đầu: `14e124e`.

## Mục tiêu đã được owner yêu cầu

Hoàn thiện phần Claude đang sửa; vận hành team theo Kanban, giảm gate nối tiếp.
“Transformer” ở đây là đồ thị công việc: các nhánh đọc cùng input, làm song song,
gộp kết quả review thành verdict, truyền feedback và lặp sửa có giới hạn.
Không triển khai neural network hoặc chia một việc nhỏ cho nhiều bot cùng ghi file.

## Phạm vi bổ sung từ owner

Process phải mở để dùng cho code, xây app và nhiều quy trình khác nhau. Graph
không bị khóa vào bốn tầng; đây là recipe chỉnh được. Mỗi bước map executor
`botId`, adviser `askBotId`, model và effort; tool/computer kế thừa profile của
executor, không có grant tool riêng từng bước. Xem [recipe và hướng dẫn map](../process-recipes/README.md).
Recipe `build-app.json` giao app local và không bắt owner gate mặc định; recipe
visual có batch duyệt khi scope yêu cầu. Chưa bật recipe vào dữ liệu live.

Computer use là hạng mục cần điều tra riêng: bản sửa tìm staged macOS driver đã
có từ phiên trước, không phải sửa mới của lượt này. Regression hiện tại pass
không chứng minh chuột/phím/chụp màn hình thực tế. Chưa có mô tả lỗi cụ thể
của owner để kết luận nguyên nhân hay ghi FIXED.

## Nguồn và trạng thái ban đầu

- Claude session `354bc6ab-e70a-4274-9bb7-d3b01f147a29`, dừng vì quota lúc 22:36 ngày 31/10 (Sydney).
- Transcript local: `~/.claude/projects/-Users-vandaole-Documents-side-project-agent-drive-OpenMausBot-main/354bc6ab-e70a-4274-9bb7-d3b01f147a29.jsonl`.
- Có code chưa commit: structured verdict, điều kiện/otherwise, loop, forEach,
  join, model/bot/approval từng bước, autoRun, queue theo bot và retry provider.
- Log Claude có 72 test liên quan pass. Đây là bằng chứng phiên trước, cần xác minh
  phiên hiện tại; không coi unit pass là đã chứng minh user workflow.
- Test `server/bot-process-autorun.e2e.test.ts` mới viết, chưa chạy trong phiên Claude.
- Job dịch đã kết thúc nhưng chưa xác minh từng locale và `i18n:check`.
- Chưa cập nhật recipe process mới, chưa thay quy trình game, chưa commit.
- Working tree có cả thay đổi Telegram/CUA/routing từ trước; giữ nguyên phần ngoài phạm vi.

## Thiết kế vận hành

### Bốn tầng thay cho chuỗi khoảng 12 gate

1. **Spec:** chốt input, acceptance, artifact, phạm vi ghi; plan và Plan Scorer là
   các bước bên trong tầng này. Model mạnh lập/chấm plan, worker nhỏ bám plan đã đạt.
2. **Build:** worker triển khai trên phạm vi riêng và tự chạy kiểm tra bằng tool.
   Các màn/module độc lập được chạy đồng thời trong giới hạn WIP.
3. **Review song song:** visual, interaction/gameplay và code/runtime đọc cùng
   revision; gộp verdict với bằng chứng. Lỗi nghiêm trọng chặn; góp ý nhỏ thành
   follow-up. Quorum đủ số kết quả không tự có nghĩa đủ phiếu PASS; kiểm tra verdict
   trong bước tổng hợp. Không cho quorum che lỗi bắt buộc của acceptance.
4. **Owner duyệt theo đợt:** gom artifact và câu hỏi cần quyết định. Nhánh độc lập
   tiếp tục; revision chưa duyệt vẫn là draft, không publish hoặc tích hợp vào
   runtime được bảo vệ khi chưa có duyệt bắt buộc.

Loop: FAIL → feedback → sửa, tối đa số vòng đã cấu hình; hết vòng thì chuyển Chief/
model mạnh/owner với lý do. Không tự coi hết vòng là PASS.

### Kanban

Luồng: BACKLOG → READY → IN_PROGRESS → REVIEW → OWNER_REVIEW → DONE.
WAITING dùng cho dependency hoặc batch duyệt đang chờ; BLOCKED chỉ dành cho vấn đề
thật (thiếu tool/input, lỗi engine kéo dài, quyết định không có phương án đã được phép).
Mỗi việc ghi dependency, owner, tập file ghi và bằng chứng; chỉ kéo việc READY khi còn slot.

- WIP board game giữ giới hạn hiện hành cho tới khi đối chiếu contract; app queue
  hiện đặt tối đa 4 bot, mỗi bot một task. Hai giới hạn này không đồng nghĩa.
- Các nhánh độc lập chạy cùng lúc; không giữ khóa toàn team chỉ vì một nhánh chờ owner.
- Shared files/editor: một writer; các worker khác làm ở phạm vi không giao nhau.
- Provider lỗi tạm thời: retry có backoff, hủy được, giữ heartbeat; không retry lỗi
  quyền/input hoặc lặp lại hành động bên ngoài đã thực hiện.
- Telegram gửi kết quả, blocker thật, quyết định và thay đổi có ý nghĩa; chống lặp.
  Lịch 10 phút là lịch kiểm tra, không bắt buộc gửi tin nếu không có thay đổi.
- Không tự suy diễn im lặng là approval. Default khi timeout chỉ dùng trong phạm vi
  owner đã cho phép, kết quả reject/timeout không được biến thành PASS.

## Chia việc và khóa file

Trước mỗi phiên: đọc file này, `AGENTS.md`, `git status --short`, diff đúng vùng sẽ
sửa; cập nhật bảng claim trước khi ghi code. Nếu task đã có người RUNNING thì nhận
task khác hoặc ghi handoff, không ghi đè. Không dùng `git add .` hay reset WIP.
Chỉ người đang tích hợp cập nhật bảng chung; bên kia bàn giao trong file evidence riêng.

| ID | Việc | Người nhận | Trạng thái | Phạm vi |
| --- | --- | --- | --- | --- |
| P1 | Đối chiếu code, chạy test baseline và E2E autorun | Codex | DONE | process engine, routes, coordinator, test tương ứng |
| P2 | Sửa các case song song/join/loop/retry/cancel phát hiện qua test | Codex | DONE | cùng vùng P1; không có writer thứ hai |
| P3 | Kiểm tra UI/schema/tool đồng nhất, i18n và tài liệu | Codex | DONE | BotProcess*, shared/bot-design, locales, docs/verification |
| P4 | Đối chiếu/migrate contract Kanban 4 tầng trong repo game | Codex | DONE | chỉ contract, skill và board sau khi đọc AGENTS/checklist tại repo game |
| P5 | Acceptance trên server fixture, lưu evidence và kết quả cuối | Codex | DONE | test E2E, evidence, plan này |
| P6 | Review độc lập sau handoff | Claude | UNCLAIMED | đọc diff và evidence; claim file trước nếu cần sửa |

P6 chưa được gửi cho một phiên Claude đang chạy. Bảng này là bàn giao qua file,
không phải bằng chứng hai agent đã thực hiện review.

## Các case nghiệm thu

- [x] AutoRun: Chief giao việc → worker chạy graph → kết quả quay về Chief; task
  trong app cũng dùng process, chat trực tiếp vẫn dùng turn thông thường.
- [x] Hai nhánh độc lập thực sự cùng chạy trước khi nhánh còn lại kết thúc; join
  nhận đúng inputs, không chạy khi điều kiện đầu vào chưa thỏa.
- [x] Fan-out có giới hạn concurrency; any/all/quorum và item lỗi có hành vi rõ ràng.
- [x] Review FAIL rồi PASS: loop nhận feedback, số lần chạy đúng; hết vòng không
  deliver lỗi như một thành công; có nhánh escalation.
- [x] when/otherwise/AI condition; JSON lỗi, graph lỗi, nhánh không chọn và root
  routing đều có kết quả/lý do rõ ràng.
- [x] Retry lỗi 502 rồi hồi phục; cancel dừng chờ; lỗi vĩnh viễn không retry.
- [x] Tasks của các bot khác nhau chạy song song, cùng bot chạy tuần tự, đúng trần.
- [x] Approval approve/reject/timeout được giữ đúng; nhánh độc lập không đứng chờ vô ích.
- [x] UI lưu/đọc được cấu hình mới; lint, typecheck, i18n đạt.
- [x] Contract game phản ánh 4 tầng và Kanban; giữ specialist review, provenance
  revision và duyệt bắt buộc; không đổi board lịch sử thành DONE thiếu bằng chứng.

## Kiểm chứng

Theo [verification README](../verification/README.md), mọi mutation kiểm thử chỉ
chạy trên fixture có HOME/data-dir riêng. Không dùng live app, Telegram thật hay
dữ liệu game thật để smoke test. E2E dùng launcher chung cũng là server fixture.

```sh
pnpm exec vitest run shared/process-run.test.ts shared/workflow.test.ts server/workflow-condition.test.ts server/prompt-tags.test.ts server/routes/bot-design.test.ts server/routes/internal-bot-process.test.ts server/routes/workflows.test.ts server/runtime-coordinator.test.ts server/drivers/agents-process-tools.test.ts server/drivers/agents-catalog-wire.test.ts server/workflow-telegram.test.ts
pnpm exec vitest run server/bot-process-authoring.e2e.test.ts server/bot-process-autorun.e2e.test.ts server/workflow-routing.e2e.test.ts
pnpm lint
pnpm typecheck
pnpm i18n:check
```

Giữ command, exit code, test count, fixture URL, log/evidence path và kết quả state.
Nếu cần smoke thủ công: `node --experimental-strip-types scripts/control-omb.ts launch`,
dùng URL in ra tường minh với `pnpm control:omb doctor --url http://127.0.0.1:PORT`;
Ctrl-C launcher để dọn đúng fixture.

## Nhật ký thực hiện / handoff

### Process check — P4, governance only

- Goal / owner_requirement: áp dụng process song song và Kanban owner vừa yêu cầu;
  không triển khai gameplay trong lượt này.
- Artifact: process contract hiện hành (tài liệu repo, chưa đăng ký studio ID).
  Trước khi sửa: dùng studio locate/context để xác định có phải managed artifact.
- Phase / responsible_role: Spec/Build tài liệu; Codex đóng vai process maintainer.
- Inputs: AGENTS.md, before-action-checklist.md; tiếp theo đối chiếu current-owner-context,
  parallel-execution, team-contract và skill Manager; giữ toàn bộ approval hiện có.
- Prerequisite: owner cho phép plan + implement; không có approval sản phẩm mới.
- Allowed writes: docs/agents/transformer-kanban.md, docs/agents/parallel-execution.md,
  docs/agents/current-owner-context.md, docs/agents/team-contract.md,
  docs/agents/before-action-checklist.md, docs/agents/README.md trong game-Oot-farm;
  mở rộng đường dẫn chỉ sau khi cập nhật record này.
- Scope mở rộng trước ghi (23:16 Sydney): production/milestones/board.md và
  .runtime/tmp/producer/transformer-kanban-20261031/** để backup/hash và lưu migration.
  Chỉ đổi BLOCKED thuần của hàng chưa chạy, có dependency, task —, evidence NOT_RUN
  thành WAITING; giữ mọi ID, dependency, evidence, gate và blocker thật.
- Expected outputs: contract bốn tầng, trạng thái WAITING, WIP3 và nguyên tắc reviewer/join.
- Independent reviewer: Claude P6 chưa claim; không ghi review PASS giả.
- Next gate: kiểm tra setup/doc links; owner/Claude xem contract; runtime NOT_RUN.
- Unknowns: studio ownership, trạng thái board thật và receipts; không sửa status lịch sử
  khi chưa có bằng chứng.

| Thời điểm | Agent | Việc / bằng chứng | Kết quả / bước tiếp |
| --- | --- | --- | --- |
| 2026-10-31 | Codex | Đọc transcript Claude, diff và recipe verification; tạo plan trước triển khai | P1 RUNNING; chưa chạy kiểm tra mới |

Hoàn tất khi các case áp dụng có bằng chứng hiện tại, contract và recipe đồng nhất,
các giới hạn chưa kiểm chứng được nêu rõ. Không gộp green test với whole-game sign-off.

## Kết quả thực hiện hiện tại — 31/10/2026, 23:24 Sydney

P1–P5 hoàn tất trong phạm vi code, tài liệu và fixture; P6 Claude review vẫn
UNCLAIMED. Không có phiên Claude nào được gửi việc hay tạo review PASS.

- Sửa fan-out để verdict tổng hợp đi xuống nhánh sau; item FAIL không bị item
  PASS cuối ghi đè. Thiếu verdict không được qua điều kiện `!= FAIL`; bước
  yêu cầu structured verdict từ chối output không hợp lệ.
- Feedback phải join các nhánh đọc shared input trước khi quay lại sửa; hết
  vòng phải có conditional escalation, không tự đi qua nhánh deliver vô điều kiện.
- Stop ngắt mọi conversation đang chạy, chặn item mới và hủy backoff; hủy không
  đánh dấu step là failed. Lỗi nghiêm trọng cũng ngắt các sibling đang chạy.
- Sửa thứ tự fake-engine script của E2E Claude để delegation được thử đúng.
  Thêm E2E chạy recipe với ba reviewer bot cùng revision và owner offline.
- Có hai recipe: build-app và transformer-kanban; đã kiểm schema/graph.
  Build-app được chạy qua executor với PASS và FAIL liên tục: route đúng,
  FAIL chạy ba lượt build (lượt đầu + hai vòng sửa) rồi escalate.
- Contract game: Spec → Build → parallel Review → owner batch theo scope,
  giữ specialist, revision, duyệt bắt buộc và WIP3. Board giữ 337 hàng,
  chỉ 319 status BLOCKED chưa chạy/chờ dependency chuyển WAITING.
  Backup/hash/receipt tại game-Oot-farm/.runtime/tmp/producer/transformer-kanban-20261031/.
  Đối chiếu từng hàng xác nhận chỉ status thay đổi; hash và link mới hợp lệ.

### Bằng chứng chạy mới

| Check | Kết quả | Giới hạn |
| --- | --- | --- |
| 12 file process/workflow/coordinator/tool/UI state theo command trên | 211 PASS trước case backoff mới | Không phải screenshot UI |
| Chạy lại shared/process-run + routes/bot-design sau sửa cuối | 35 PASS (15 + 20) | Thay cho 34 test cũ; tổng nhóm hiện tại 212 case |
| 3 file E2E authoring/autorun/routing | 5 PASS | Server fixture + scripted CLI, không phải paid-model quality |
| 9 file CUA launch/connection/local-routing/system-prompt/MCP | 122 PASS, 1 SKIP chỉ Linux | Không điều khiển desktop thật |
| lint / typecheck / i18n:check | PASS | Locale hợp lệ; tiếng Việt mới 73%, không phải dịch đủ |
| git diff --check và receipt game | PASS | Game runtime và hot-reload NOT_VERIFIED |

Các E2E dùng launcher HOME/data-dir riêng theo verification README; fixture đã
dọn, không gửi tin Telegram thật hoặc mutate live app. Evidence giữ tại:

`/var/folders/6l/mkrs2c291rz4_fnf05d7lyqm0000gn/T/openmausbot-verification-evidence/`

- `server-1793449278024-11538.log.bot-process-autorun.json` — fixture http://127.0.0.1:21070
- `server-1793449285026-11538.log.transformer-kanban.json` — fixture http://127.0.0.1:20154
- `server-1793449290040-11747.log.workflow-routing.json` — fixture http://127.0.0.1:20708
- `server-1793449294635-11747.log.request-routing.json` — fixture http://127.0.0.1:20509
- `server-1793449298841-11828.log.bot-process-authoring.json` — fixture http://127.0.0.1:20446

### Handoff tiếp theo

Claude claim P6 sau khi đọc plan và diff; tập trung invariant join/loop, cancel,
verdict tổng hợp và mapping capability. Nếu sửa, ghi phạm vi claim rồi chạy
fixture tương ứng. Không lấy test xanh làm whole-game/app release approval.
Computer use: tái hiện lỗi cụ thể trên disposable target, kiểm bot Computer/tool
profile, transport rồi capture/input; không lấy driver readiness làm bằng chứng
full control. Còn cần kiểm renderer thực tế nếu muốn chốt UX của editor.

### Kiểm thử model thật và frontend

Xem [báo cáo chạy thật](../verification/process-levels-live-2026-10-31.md).
Backend ba mức đều deliver; frontend mức thường/khó deliver, mức phức tạp
escalate vì reviewer báo thiếu capability file/shell. Browser của bot bị chặn
cả server do chính bot khởi chạy bằng native shell. Không chốt computer use PASS.
Di chuyển ba folder giữ token/context khi cung cấp đường dẫn mới và rebind cwd;
chưa chứng minh tự tìm folder sau move. Các blocker này còn OPEN, P6 vẫn UNCLAIMED.

## Owner bổ sung 2026-11-01

- Ba bot test trong Electron dùng GPT-6.1 Terra, approval full.
- Bỏ câu hỏi Allow once khi Auto dùng host; giữ khóa một writer cho màn hình.
- Thêm Enable computer use trong Access, mặc định bật (Auto); tắt dùng Off,
  bật lại dùng Auto. Không ghi MCP/token của từng lượt vào cấu hình CLI toàn cục.
- Electron tự khởi động driver đã bundle; native CLI nhận MCP qua adapter.
  Quyền OS vẫn cần được cấp; không coi model thiếu native computer use là
  thiếu MCP capability. Engine không hỗ trợ tool không được giả vờ hỗ trợ.
- Kiểm tra MCP client bằng reproducer trước khi kết luận nguyên nhân.
- Bot phức tạp phải tìm tài liệu/video bằng browser thật và lưu nguồn đã kiểm tra.


### Kết quả follow-up Terra

Ba bot tạo từ desktop Electron đã hoàn tất normal/hard/complex bằng
GPT-6.1 Terra/full. Complex chứng minh FAIL → repair → PASS → deliver, không
escalate vì thiếu file/shell. Test độc lập và chuyển folder cả ba mức đều PASS
khi cung cấp đường dẫn mới + rebind cwd. Bot complex đã tìm/mở tài liệu và video
bằng browser, tạo catalog localhost và click bộ lọc Videos thành công.

Đã sửa ownership localhost macOS và prompt capability. Đã thêm Enable computer
use ở tab Computer thực tế và Access, dùng chung control; Off/Auto persist đúng.
Bỏ câu hỏi first-use host trong runtime, giữ mutex/takeover/quyền OS. P6 vẫn
chờ Claude review độc lập. Báo cáo Terra mới bổ sung cuối file verification;
không lấy các blocker Sol cũ làm trạng thái hiện tại.
