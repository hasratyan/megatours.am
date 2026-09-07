export const insurancePendingCopy = (locale: string) => locale === "hy"
  ? { title: "Հաստատումը սպասվում է", body: "Ապահովագրության հաստատումը սպասվում է։ Կրկին մի՛ ուղարկեք հայտը և մի՛ վճարեք։ Մեր աջակցման թիմը կճշտի պոլիսների կարգավիճակը EFES-ի հետ։" }
  : locale === "ru"
    ? { title: "Ожидается подтверждение", body: "Ожидается подтверждение страховки. Не отправляйте заявку и не оплачивайте повторно. Наша служба поддержки уточнит статус полисов в EFES." }
    : { title: "Confirmation pending", body: "Insurance confirmation is pending. Please do not submit or pay again. Our support team will verify the policy status with EFES." };
