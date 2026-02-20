"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import type { Locale as AppLocale } from "@/lib/i18n";
import type { PackageBuilderState, ServiceFlags } from "@/lib/package-builder-state";
import {
  DEFAULT_SERVICE_FLAGS,
  openPackageBuilder,
  updatePackageBuilderState,
} from "@/lib/package-builder-state";
import type {
  PackageAssistantApiMessage,
  PackageAssistantContext,
  PackageAssistantDraft,
  PackageAssistantPackageOption,
  PackageAssistantReply,
  PackageAssistantResponse,
} from "@/types/package-assistant";

type PackageBuilderAiChatProps = {
  locale: AppLocale;
  context?: PackageAssistantContext | null;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const copyMap: Record<
  AppLocale,
  {
    title: string;
    subtitle: string;
    welcome: string;
    placeholder: string;
    send: string;
    quickPrompts: string[];
    searching: string;
    optionsTitle: string;
    apply: string;
    applied: string;
    missingPrefix: string;
    fallbackError: string;
    launcher: string;
    close: string;
    open: string;
    livePrice: string;
  }
> = {
  en: {
    title: "Megatours Concierge AI",
    subtitle: "Premium package builder with live supplier data.",
    welcome:
      "Tell me your destination, dates, traveler count, and budget. I’ll craft premium package options.",
    placeholder: "Example: Dubai, 5 nights in March, 2 adults + 1 child, around $1,800.",
    send: "Send",
    quickPrompts: [
      "Build me a value Dubai package",
      "I want premium Abu Dhabi with private transfer",
      "Add family-friendly excursions to my package",
    ],
    searching: "Curating your options...",
    optionsTitle: "Suggested Packages",
    apply: "Apply To Builder",
    applied: "Applied",
    missingPrefix: "Still needed:",
    fallbackError: "Unable to contact assistant right now. Please try again.",
    launcher: "AI Concierge",
    close: "Close assistant",
    open: "Open assistant",
    livePrice: "Live prices",
  },
  hy: {
    title: "Megatours Concierge AI",
    subtitle: "Պրեմիում փաթեթների հավաքում՝ իրական մատակարարների տվյալներով։",
    welcome:
      "Գրեք ուղղությունը, ամսաթվերը, ուղևորների քանակը և բյուջեն․ կառաջարկեմ լավագույն փաթեթներ։",
    placeholder: "Օրինակ՝ Դուբայ, 5 գիշեր մարտին, 2 մեծ + 1 երեխա, մոտ $1,800։",
    send: "Ուղարկել",
    quickPrompts: [
      "Կազմիր բյուջետային Դուբայ փաթեթ",
      "Ուզում եմ premium Աբու Դաբի՝ անհատական տրանսֆերով",
      "Ավելացրու ընտանեկան էքսկուրսիաներ",
    ],
    searching: "Ձևավորում եմ լավագույն տարբերակները...",
    optionsTitle: "Առաջարկվող Փաթեթներ",
    apply: "Ավելացնել Builder-ին",
    applied: "Ավելացված է",
    missingPrefix: "Պետք է նաև՝",
    fallbackError: "Օգնականը ժամանակավորապես հասանելի չէ։ Կրկին փորձեք։",
    launcher: "AI Concierge",
    close: "Փակել օգնականը",
    open: "Բացել օգնականը",
    livePrice: "Կենդանի գներ",
  },
  ru: {
    title: "Megatours Concierge AI",
    subtitle: "Премиальная сборка туров на основе живых данных поставщиков.",
    welcome:
      "Напишите направление, даты, состав туристов и бюджет. Подготовлю лучшие пакетные варианты.",
    placeholder: "Например: Дубай, 5 ночей в марте, 2 взрослых + 1 ребенок, около $1,800.",
    send: "Отправить",
    quickPrompts: [
      "Собери мне выгодный пакет в Дубай",
      "Хочу premium Абу-Даби с private трансфером",
      "Добавь семейные экскурсии к моему туру",
    ],
    searching: "Подбираю варианты...",
    optionsTitle: "Рекомендуемые Пакеты",
    apply: "Применить В Builder",
    applied: "Применено",
    missingPrefix: "Еще нужно:",
    fallbackError: "Не удалось связаться с ассистентом. Повторите попытку.",
    launcher: "AI Concierge",
    close: "Закрыть ассистента",
    open: "Открыть ассистента",
    livePrice: "Живые цены",
  },
};

const createMessageId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const formatPrice = (amount: number | null | undefined, currency: string | null | undefined) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const code = typeof currency === "string" && currency.trim().length > 0 ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: amount < 100 ? 2 : 0,
    }).format(amount);
  } catch {
    return `${code} ${Math.round(amount).toLocaleString()}`;
  }
};

const buildPackageStateFromDraft = (draft: PackageAssistantDraft): PackageBuilderState => {
  const now = Date.now();
  const state: PackageBuilderState = {
    updatedAt: now,
  };

  if (draft.hotel?.selected) {
    const roomCount =
      typeof draft.hotel.roomCount === "number" && draft.hotel.roomCount > 0
        ? Math.floor(draft.hotel.roomCount)
        : 1;
    const guestCount =
      typeof draft.hotel.guestCount === "number" && draft.hotel.guestCount > 0
        ? Math.floor(draft.hotel.guestCount)
        : roomCount * 2;
    state.hotel = {
      selected: true,
      hotelCode: draft.hotel.hotelCode ?? null,
      hotelName: draft.hotel.hotelName ?? null,
      destinationCode: draft.hotel.destinationCode ?? null,
      destinationName: draft.hotel.destinationName ?? null,
      checkInDate: draft.hotel.checkInDate ?? null,
      checkOutDate: draft.hotel.checkOutDate ?? null,
      roomCount,
      guestCount,
      mealPlan: draft.hotel.mealPlan ?? null,
      nonRefundable: draft.hotel.nonRefundable ?? null,
      price: draft.hotel.price ?? null,
      currency: draft.hotel.currency ?? null,
    };
  }

  if (draft.transfer?.selected) {
    state.transfer = {
      selected: true,
      selectionId: draft.transfer.selectionId ?? null,
      label: draft.transfer.label ?? null,
      price: draft.transfer.price ?? null,
      currency: draft.transfer.currency ?? null,
      destinationName: draft.transfer.destinationName ?? null,
      destinationCode: draft.transfer.destinationCode ?? null,
      transferOrigin: draft.transfer.transferOrigin ?? null,
      transferDestination: draft.transfer.transferDestination ?? null,
      vehicleName: draft.transfer.vehicleName ?? null,
      vehicleMaxPax: draft.transfer.vehicleMaxPax ?? null,
      transferType: draft.transfer.transferType ?? null,
      includeReturn: draft.transfer.includeReturn ?? null,
      vehicleQuantity: draft.transfer.vehicleQuantity ?? null,
      origin: draft.transfer.origin ?? null,
      destination: draft.transfer.destination ?? null,
      vehicle: draft.transfer.vehicle ?? null,
      paxRange: draft.transfer.paxRange ?? null,
      pricing: draft.transfer.pricing ?? null,
      validity: draft.transfer.validity ?? null,
      chargeType: draft.transfer.chargeType ?? null,
      paxCount: draft.transfer.paxCount ?? null,
    };
  }

  if (draft.flight?.selected) {
    state.flight = {
      selected: true,
      selectionId: draft.flight.selectionId ?? null,
      label: draft.flight.label ?? null,
      price: draft.flight.price ?? null,
      currency: draft.flight.currency ?? null,
      origin: draft.flight.origin ?? null,
      destination: draft.flight.destination ?? null,
      departureDate: draft.flight.departureDate ?? null,
      returnDate: draft.flight.returnDate ?? null,
      cabinClass: draft.flight.cabinClass ?? null,
      notes: draft.flight.notes ?? null,
    };
  }

  if (draft.excursion?.selected) {
    const items = (draft.excursion.items ?? []).filter((item) => item?.id);
    state.excursion = {
      selected: true,
      label:
        draft.excursion.label ??
        (items.length > 0 ? `${items.length} excursions selected` : "Excursions"),
      price: draft.excursion.price ?? null,
      currency: draft.excursion.currency ?? null,
      items: items.map((item) => ({
        id: item.id,
        name: item.name ?? null,
      })),
    };
  }

  if (draft.insurance?.selected) {
    state.insurance = {
      selected: true,
      selectionId: draft.insurance.selectionId ?? null,
      label: draft.insurance.label ?? null,
      price: draft.insurance.price ?? null,
      currency: draft.insurance.currency ?? null,
      provider: "efes",
      planId: draft.insurance.planId ?? null,
      planLabel: draft.insurance.planLabel ?? null,
      riskAmount: draft.insurance.riskAmount ?? null,
      riskCurrency: draft.insurance.riskCurrency ?? null,
      riskLabel: draft.insurance.riskLabel ?? null,
      startDate: draft.insurance.startDate ?? null,
      endDate: draft.insurance.endDate ?? null,
      days: draft.insurance.days ?? null,
    };
  }

  return state;
};

const resolveOptionTags = (option: PackageAssistantPackageOption) => {
  const tags: string[] = [];
  if (option.draft.hotel?.selected) tags.push("Hotel");
  if (option.draft.transfer?.selected) tags.push("Transfer");
  if (option.draft.flight?.selected) tags.push("Flight");
  if (option.draft.excursion?.selected) tags.push("Excursion");
  if (option.draft.insurance?.selected) tags.push("Insurance");
  return tags;
};

export default function PackageBuilderAiChat({ locale, context }: PackageBuilderAiChatProps) {
  const copy = copyMap[locale] ?? copyMap.en;
  const [isOpen, setIsOpen] = useState(false);
  const [isAiChatEnabled, setIsAiChatEnabled] = useState(DEFAULT_SERVICE_FLAGS.aiChat);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: createMessageId(),
      role: "assistant",
      content: copy.welcome,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [packageOptions, setPackageOptions] = useState<PackageAssistantPackageOption[]>([]);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [appliedOptionId, setAppliedOptionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadFlags = async () => {
      try {
        const data = await getJson<{ flags?: ServiceFlags }>("/api/services/availability");
        if (!active) return;
        const mergedFlags = { ...DEFAULT_SERVICE_FLAGS, ...(data.flags ?? {}) };
        setIsAiChatEnabled(mergedFlags.aiChat !== false);
      } catch {
        if (!active) return;
        setIsAiChatEnabled(DEFAULT_SERVICE_FLAGS.aiChat);
      }
    };
    loadFlags();
    return () => {
      active = false;
    };
  }, []);

  const contextChips = useMemo(() => {
    const chips: string[] = [];
    if (context?.destinationName) chips.push(context.destinationName);
    if (context?.checkInDate && context?.checkOutDate) {
      chips.push(`${context.checkInDate} -> ${context.checkOutDate}`);
    }
    if (typeof context?.adults === "number") {
      const adults = Math.max(1, Math.floor(context.adults));
      const children =
        typeof context.children === "number" && context.children > 0
          ? Math.floor(context.children)
          : 0;
      chips.push(children > 0 ? `${adults} + ${children}` : `${adults} pax`);
    }
    return chips;
  }, [context?.adults, context?.checkInDate, context?.checkOutDate, context?.children, context?.destinationName]);

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    const userMessage: UiMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
    };
    const assistantMessageId = createMessageId();
    const conversationMessages: PackageAssistantApiMessage[] = [...messages, userMessage].map(
      (message) => ({
        role: message.role,
        content: message.content,
      })
    );
    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
      },
    ]);
    setInputValue("");
    setErrorMessage(null);
    setIsSending(true);

    try {
      const applyReply = (nextReply: PackageAssistantReply) => {
        setPackageOptions(nextReply.packageOptions ?? []);
        setMissingFields(nextReply.missing ?? []);
        const finalMessage =
          nextReply.message.trim().length > 0 ? nextReply.message : copy.welcome;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantMessageId ? { ...message, content: finalMessage } : message
          )
        );
      };

      const appendAssistantToken = (delta: string) => {
        if (!delta) return;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${delta}` }
              : message
          )
        );
      };

      const requestJsonFallback = async () => {
        const response = await postJson<PackageAssistantResponse>("/api/chat/package-builder", {
          sessionId,
          locale,
          messages: conversationMessages,
          context: context ?? null,
        });
        if (!response.ok) {
          throw new Error(response.error);
        }
        setSessionId(response.sessionId);
        applyReply(response.reply);
      };

      let receivedReply = false;
      try {
        const streamResponse = await fetch("/api/chat/package-builder?stream=1", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify({
            sessionId,
            locale,
            messages: conversationMessages,
            context: context ?? null,
            stream: true,
          }),
        });

        if (!streamResponse.ok || !streamResponse.body) {
          throw new Error("Streaming unavailable");
        }

        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;
            const type = typeof parsed.type === "string" ? parsed.type : "";
            if (type === "session") {
              if (typeof parsed.sessionId === "string" && parsed.sessionId.trim().length > 0) {
                setSessionId(parsed.sessionId);
              }
              continue;
            }
            if (type === "token") {
              appendAssistantToken(typeof parsed.delta === "string" ? parsed.delta : "");
              continue;
            }
            if (type === "reply") {
              const reply = parsed.reply as PackageAssistantReply | undefined;
              if (reply && typeof reply === "object") {
                applyReply(reply);
                receivedReply = true;
              }
              continue;
            }
            if (type === "error") {
              throw new Error(
                typeof parsed.error === "string" ? parsed.error : copy.fallbackError
              );
            }
          }
        }
      } catch {
        await requestJsonFallback();
        receivedReply = true;
      }

      if (!receivedReply) {
        await requestJsonFallback();
      }
    } catch (error) {
      const safeMessage = resolveSafeErrorFromUnknown(error, copy.fallbackError);
      setErrorMessage(safeMessage);
      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantMessageId ? { ...message, content: safeMessage } : message
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendMessage(inputValue);
  };

  const onInputKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await sendMessage(inputValue);
  };

  const onApplyOption = (option: PackageAssistantPackageOption) => {
    updatePackageBuilderState(() => buildPackageStateFromDraft(option.draft));
    openPackageBuilder();
    setAppliedOptionId(option.id);
  };

  if (!isAiChatEnabled) {
    return null;
  }

  return (
    <div className={`concierge-ai${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="concierge-ai__launcher"
        aria-label={isOpen ? copy.close : copy.open}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="material-symbols-rounded" aria-hidden="true">
          auto_awesome
        </span>
        <span>{copy.launcher}</span>
      </button>

      <section className="concierge-ai__panel" aria-hidden={!isOpen}>
        <div className="concierge-ai__header">
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <button
            type="button"
            className="concierge-ai__close"
            aria-label={copy.close}
            onClick={() => setIsOpen(false)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {contextChips.length > 0 ? (
          <div className="concierge-ai__chips">
            {contextChips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}

        <div className="concierge-ai__content">
          <div className="concierge-ai__messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`concierge-ai__message concierge-ai__message--${message.role}`}
              >
                <p>{message.content}</p>
              </article>
            ))}
            {isSending ? <div className="concierge-ai__typing">{copy.searching}</div> : null}
          </div>

          {missingFields.length > 0 ? (
            <p className="concierge-ai__missing">
              <strong>{copy.missingPrefix}</strong> {missingFields.join(", ")}
            </p>
          ) : null}

          {packageOptions.length > 0 ? (
            <div className="concierge-ai__options">
              <h3>{copy.optionsTitle}</h3>
              <div className="concierge-ai__options-grid">
                {packageOptions.map((option) => {
                  const total = formatPrice(option.approxTotal?.amount, option.approxTotal?.currency);
                  const tags = resolveOptionTags(option);
                  return (
                    <article key={option.id} className="concierge-ai__option-card">
                      <div>
                        <h4>{option.title}</h4>
                        {typeof option.confidence === "number" ? (
                          <span>{Math.round(option.confidence * 100)}%</span>
                        ) : null}
                      </div>
                      <p>{option.summary}</p>
                      {tags.length > 0 ? (
                        <div className="concierge-ai__option-tags">
                          {tags.map((tag) => (
                            <span key={`${option.id}-${tag}`}>{tag}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="concierge-ai__option-footer">
                        <div>
                          <strong>{total ?? copy.livePrice}</strong>
                          {option.approxTotal?.note ? <small>{option.approxTotal.note}</small> : null}
                        </div>
                        <button type="button" onClick={() => onApplyOption(option)}>
                          {appliedOptionId === option.id ? copy.applied : copy.apply}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <form className="concierge-ai__input" onSubmit={onSubmit}>
          <textarea
            value={inputValue}
            placeholder={copy.placeholder}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={isSending}
            rows={2}
            maxLength={700}
          />
          <button type="submit" disabled={isSending || inputValue.trim().length === 0}>
            {copy.send}
          </button>
        </form>

        <div className="concierge-ai__quick-prompts">
          {copy.quickPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => sendMessage(prompt)} disabled={isSending}>
              {prompt}
            </button>
          ))}
        </div>

        {errorMessage ? <p className="concierge-ai__error">{errorMessage}</p> : null}
      </section>
    </div>
  );
}
