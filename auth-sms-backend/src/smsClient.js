import tencentcloud from 'tencentcloud-sdk-nodejs-sms';

const SmsClient = tencentcloud.sms.v20210111.Client;

export function createSmsClient() {
  const secretId = process.env.TENCENT_SMS_SECRET_ID;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('Missing Tencent SMS credentials');
  }
  const client = new SmsClient({
    credential: {
      secretId,
      secretKey,
    },
    region: 'ap-guangzhou',
    profile: {
      httpProfile: { endpoint: 'sms.tencentcloudapi.com' },
    },
  });
  return client;
}

export async function sendSmsCode({ phoneNumberE164, code }) {
  const client = createSmsClient();
  const appId = process.env.TENCENT_SMS_APP_ID;
  const signName = process.env.TENCENT_SMS_SIGN;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID;
  if (!appId || !signName || !templateId) {
    throw new Error('Missing Tencent SMS App/Sign/Template');
  }
  const params = {
    PhoneNumberSet: [phoneNumberE164],
    SmsSdkAppId: appId,
    SignName: signName,
    TemplateId: templateId,
    TemplateParamSet: [code, '5'],
  };
  const resp = await client.SendSms(params);
  const first = resp?.SendStatusSet?.[0];
  if (!first || first.Code !== 'Ok') {
    const msg = first?.Message || 'SendSms failed';
    const codeText = first?.Code || 'Unknown';
    const reqId = resp?.RequestId;
    throw new Error(`Tencent SMS error ${codeText}: ${msg} (reqId=${reqId})`);
  }
  return true;
}


