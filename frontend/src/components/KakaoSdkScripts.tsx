import Script from "next/script";

const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakaojs/latest/kakao.min.js";

export default function KakaoSdkScripts() {
  const kakaoMapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  if (!kakaoMapKey) {
    return null;
  }

  return (
    <>
      <Script id="kakao-sdk-core" src={KAKAO_SDK_URL} strategy="afterInteractive" />
      <Script
        id="kakao-sdk-maps"
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoMapKey}&autoload=false&libraries=services,clusterer`}
        strategy="afterInteractive"
      />
    </>
  );
}
