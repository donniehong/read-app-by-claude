# 동봉한 OCR 엔진

사진 속 문장을 글자로 바꾸는 기능에 쓰입니다. 인식은 전부 **사용자의 기기 안에서**
이루어지며 사진은 어디로도 전송되지 않습니다. 오프라인에서도 동작하도록 파일을 함께 담았습니다.

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `tesseract.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 | Apache-2.0 |
| `tesseract-core-simd-lstm.js`, `.wasm` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 6.1.2 | Apache-2.0 |
| `lang/kor.traineddata.gz` | [tessdata](https://github.com/tesseract-ocr/tessdata) (@tesseract.js-data/kor 1.0.0, `4.0.0_best_int`) | Apache-2.0 |

합계 약 4.6MB. 갱신하려면:

```bash
npm pack tesseract.js tesseract.js-core @tesseract.js-data/kor
```
로 받은 뒤 같은 파일들을 덮어쓰면 됩니다.
