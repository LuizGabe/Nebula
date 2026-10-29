# Public repository and licensing review

Review date: 2026-10-29. Baseline: commit `832a33e` on the local `dev` branch.

This is a technical review of licensing indicators and publication risks, not a legal opinion or a guarantee that no claim can arise. Ownership, contract interpretation and compatibility of an actual distribution need legal review where material. Publishing source, shipping an image and operating a hosted service create different questions.

## Scope and evidence

- Inventoried 278 tracked files and inspected manifests, Compose files, worker Dockerfiles, model configuration, YouTube downloader, session deletion and selected documentation/source paths.
- Checked all 38 locally reachable commits and scanned 604 unique historical text-sized blobs (under 3 MB each) for common provider token formats, private-key headers and credential-bearing URLs. No strong token/private-key pattern findings or unexplained credential URLs were identified by those checks. No non-example `.env`, key or database filenames were found in the reachable object-path listing. This is a limited pattern scan, not a dedicated secret-scanner clearance.
- Examined installed Node manifests: 950 unique package name/version pairs, including development and possibly stale packages. All installed direct runtime dependencies declared permissive licenses. Investigated the missing license fields for `png-js` and `seq-queue`; both packages contain MIT license files. `jszip` offers an MIT option; `caniuse-lite` data uses CC-BY-4.0.
- No production database, audio, live credentials, model weights or external user account was accessed. Container contents, resolved Python dependencies, remote branches absent locally, dangling Git objects, GitHub issues/attachments, releases and caches were not audited. A clean scan cannot establish that the author owns every source fragment or asset.

## Changes made

Added the unmodified official [PolyForm Noncommercial License 1.0.0](../LICENSE), a [required copyright notice](../NOTICE), consistent package license identifiers and summaries in both READMEs. Added a [third-party review index](../THIRD_PARTY_NOTICES.md). These changes do not themselves complete third-party redistribution compliance.

The license permits noncommercial purposes, modification and redistribution subject to its conditions. It also expressly permits the listed charitable, educational, public research, public safety/health, environmental and government institutions, regardless of funding source. Commercial purposes outside its permissions require a separate grant. It is not a categorical ban on every activity performed by every legal entity. Its [official text](https://polyformproject.org/licenses/noncommercial/1.0.0) controls.

Describe Nebula as **source-available**, rather than OSI open source: the [Open Source Definition](https://opensource.org/osd) does not permit restricting business/commercial fields of use.

## Findings and next actions

### 1. Previous ISC declarations limit what a license change can accomplish

The API manifest and earlier READMEs publicly identified ISC. There was no standalone license file at the baseline. That creates a historical licensing question; absence of the full text is not a safe basis for assuming nobody received permissions. A new license cannot simply revoke valid earlier grants or remove rights in permissively licensed dependencies. Previously published code may remain available under earlier rights, depending on what was granted and its scope.

Action: apply the new policy transparently to this revision and future contributions, preserve the historical caveat, and ask counsel to assess the older revisions before relying on commercial exclusivity. Do not represent this change as making every existing copy noncommercial-only. [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains the difference between public access and a license grant.

### 2. YouTube extraction is the clearest external service-terms concern

`apps/groq_worker/infra/youtube_downloader.py` automates metadata retrieval, downloads audio through yt-dlp and extracts MP3 through FFmpeg. It rejects certain protected/private/live sources, but those technical checks do not establish download permission or ownership of a public video's audio. The [YouTube terms](https://www.youtube.com/static?template=terms) restrict downloading, automated access and circumvention outside the specified permissions.

Inference: actual use of this integration can raise contractual and copyright issues; it does not establish that publishing this general-purpose repository is itself unlawful. Permission from a video's author does not automatically waive YouTube's own contractual restrictions. Before operating this feature publicly, establish a permitted access path and content rights; if that cannot be established, disable the integration for that deployment and use authorized audio uploads. A disclaimer alone does not cure an unauthorized download. No downloader behavior was changed in this review.

### 3. Third-party services and containers have independent obligations

The Compose files reference `pgsty/minio:latest` and `redis:7-alpine`. Mutable tags prevent this review from identifying the exact server builds and their licenses. MinIO/related forks carry AGPL considerations; Redis server licensing changes between minor versions. A protocol connection alone is insufficient evidence either that Nebula must inherit a server's license or that every deployment is compliant. The [Redis license table](https://redis.io/legal/licenses/) and [MinIO compliance guidance](https://github.com/minio/minio/blob/master/COMPLIANCE.md) warrant an artifact-specific review.

FFmpeg's license depends on its build configuration; [upstream explains the LGPL/GPL distinction](https://ffmpeg.org/legal.html). The optional worker also includes an NVIDIA container and CUDA/cuDNN packages under separate terms. External model weights have their own licenses and access conditions; two referenced model cards declare CC-BY-4.0. Python version ranges are unresolved in the repository.

Action before distributing images/binaries: record exact versions/digests, inventory the built artifacts, preserve upstream license/NOTICE/attribution files and satisfy any applicable corresponding-source requirements. Providing Dockerfiles is distinct from redistributing all the binaries those Dockerfiles install. No server substitution, dependency upgrade or claim of blanket license compatibility was made here.

### 4. Hosting recordings creates privacy obligations beyond publishing source

Nebula processes audio, transcripts, questions, generated documents and account information. Audio is sent to Groq for configured batch transcription; document generation/Q&A can send text to the configured provider. Choosing a local LLM does not by itself make Groq transcription local. The browser speech mode may also rely on the browser vendor's recognition service. [Groq documents its retention controls and US data location](https://console.groq.com/docs/your-data); verify the actual account settings and transfer arrangements rather than promising zero retention.

The session DELETE route currently sets `isDeleted: true`; it is not evidence of physical erasure of database rows, object storage, backups or provider copies. Before accepting other people's recordings in a hosted service, define the lawful basis, participant notice, provider disclosures, retention/erasure process, access controls and any international-transfer mechanism. Consent is not the only possible legal basis, and voice recordings are not automatically sensitive biometric data in every context. The [ANPD FAQ](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes) explains lawful bases and that publicly accessible personal data can still be protected.

No published real recordings, database exports or user documents were identified in the tracked-file review. That observation does not cover GitHub attachments, ignored local files or a running service. Publishing code alone is different from receiving and processing other people's data.

### 5. Confirm ownership and contribution rights

The commit author names use two capitalization variants of LuizGabe; Git metadata does not prove ownership. Employment, client work, school agreements and copied source/assets can affect the right to publish and relicense. Brazilian [Software Law 9.609/1998, article 4](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html) addresses employer/contractor ownership and the conditions for independently developed employee software.

Action: confirm that Nebula contains no employer/client confidential material and that you control the rights you are offering. For future external contributions, make inbound licensing explicit. A contribution under the public noncommercial license is not automatically an assignment or permission for you to sell that contributor's code under a different license; obtain appropriate rights before promising commercial relicensing of those contributions. No name/trademark clearance was performed.

### 6. Git history already exposes author email metadata

Thirty-seven of the 38 reviewed commits use a non-noreply author email. The latest commit uses the GitHub noreply address. Changing future Git configuration does not remove an address from old commits, forks or caches.

Action: use noreply for future commits if desired. No addresses are reproduced in this report. Rewriting existing public history would need a separate decision and would not guarantee erasure of third-party copies; no history was rewritten here.

## Practical conclusion

The reviewed evidence does not establish a reason that the source repository must immediately become private. It also cannot provide legal clearance. The most concrete outstanding issues are the historical ISC grant, YouTube access/content rights, exact third-party artifact compliance and privacy preparation if recordings from other people are accepted. Publishing a repository does not itself resolve those questions, and a software license does not authorize third-party content, replace a privacy notice or guarantee immunity from liability.
