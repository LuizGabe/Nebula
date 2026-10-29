# Third-party licensing overview

Nebula's [PolyForm Noncommercial license](LICENSE) applies to its first-party material. Dependencies, model weights, base images and services keep their own licenses, attribution requirements and contractual terms. A commercial permission from Nebula's author cannot waive a third party's requirements.

This is a review index, not a complete notice bundle or a certification of compliance. For a binary, web bundle or container release, collect the license/copyright/NOTICE files and any corresponding-source obligations for the exact artifacts distributed, including transitive and operating-system dependencies.

## Application dependencies

The installed direct Node dependencies examined on 2026-10-29 declare permissive licenses: MIT, ISC, Apache-2.0, BSD-2-Clause or BSD-3-Clause. Examples include React/Fastify/BullMQ (MIT), Lucide (ISC), Prisma/AWS SDK/Groq SDK (Apache-2.0), dotenv (BSD-2-Clause) and WaveSurfer (BSD-3-Clause). Preserve the actual upstream notices when distributing their code.

The local installation also contains `jszip` 3.10.2 under `MIT OR GPL-3.0-or-later`; its MIT option is available. `png-js` 2.0.0 and `seq-queue` 0.0.5 omit a manifest license field but contain MIT license files. `caniuse-lite` 1.0.30001791 declares CC-BY-4.0; include applicable attribution when redistributing its data. The local installation can contain packages outside the release dependency graph.

Python requirements use version ranges and have no committed resolved environment. Their complete transitive licenses must be checked against the environment actually built. Do not treat the Node review as a Python audit.

## Infrastructure, media and models

| Component | License or terms to check | Project usage |
| --- | --- | --- |
| MinIO-compatible server | [MinIO AGPLv3 guidance](https://github.com/minio/minio/blob/master/COMPLIANCE.md); [PGSTY image provenance](https://hub.docker.com/r/pgsty/minio) | Compose references `pgsty/minio:latest`. Verify the exact image digest, upstream source and notices; a separate S3 service is not itself a blanket compatibility determination. |
| Redis server | [Version-dependent server licenses](https://redis.io/legal/licenses/) | `redis:7-alpine` does not pin the minor version. Redis 7.2 and earlier use BSD-3-Clause; 7.4 uses RSALv2/SSPLv1. Client library licenses are separate. |
| FFmpeg | [LGPL/GPL and build-dependent terms](https://ffmpeg.org/legal.html) | Installed in the batch container and invoked for media preprocessing. Check the exact build and source/notice requirements before redistribution. |
| yt-dlp | [Upstream licensing](https://github.com/yt-dlp/yt-dlp#licensing) | Installed through pip with the `default` extras. Upstream source/wheels use the Unlicense; bundled executables and optional dependencies can have different terms. |
| NVIDIA NeMo / CUDA / cuDNN | [NGC container listing](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/nemo) and the licenses shipped with the exact image/packages | The optional worker uses `nvcr.io/nvidia/nemo:24.09` and NVIDIA runtime packages. Their contents were not audited; do not assume every component inherits the NeMo source-code license. |
| pyannote Community-1 weights | [Model card and access conditions](https://huggingface.co/pyannote/speaker-diarization-community-1) | Optional diarization model by the pyannote team, declared CC-BY-4.0. Access requires accepting the model's conditions. No weights are included in this repository. |
| Parakeet ONNX weights | [Model card](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) | Download utility references Istupakov's ONNX conversion of NVIDIA Parakeet TDT 0.6B v3, declared CC-BY-4.0. No weights are included in this repository. |
| Converted Whisper weights | [Configured model repository](https://huggingface.co/deepdml/whisper-large-v3-turbo-ct2) | The optional worker defaults to this external conversion. Verify its model card, upstream license and exact revision before redistribution; this review did not establish those terms. |
| Groq / YouTube | [Groq data practices](https://console.groq.com/docs/your-data), [YouTube terms](https://www.youtube.com/static?template=terms) | Service terms and rights in submitted/downloaded content are separate from the software license. |

Refer to the [publication review](docs/legal-review.md) for the scope and remaining work.
