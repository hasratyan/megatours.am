export type Locale = "hy" | "en" | "ru";

export const locales: Locale[] = ["hy", "en", "ru"];
export const localeLabels: Record<Locale, string> = {
  hy: "ՀԱՅ",
  en: "ENG",
  ru: "РУС",
};
export const defaultLocale: Locale = "hy";

export type PluralForms = {
  zero?: string;
  one: string;
  two?: string;
  other: string;
  few?: string;
  many?: string;
};

export type PolicySection = {
  title: string;
  body?: string;
  items?: string[];
};

export type Translation = {
  nav: { href: string; label: string }[];
  labels: { exclusive: string };
  hero: {
    title: string;
    subtitle: string;
    purpose: string;
    marquee: string;
  };
  search: {
    wherePlaceholder: string;
    loadingDestinations: string;
    noLocations: string;
    adultsLabel: string;
    adultsShort: string;
    childrenLabel: string;
    childrenShort: string;
    childrenAges: string;
    roomsLabel: string;
    roomLabel: string;
    datePlaceholder: string;
    submitIdle: string;
    submitLoading: string;
    expandSearch: string;
    collapseSearch: string;
    unknownHotel: string;
    pickOnMap: string;
    closeMap: string;
    mapLoading: string;
    mapEmpty: string;
    mapHotelsCount: PluralForms;
    mapSelectHint: string;
    errors: {
      missingLocation: string;
      missingDates: string;
      invalidRooms: string;
      missingSession: string;
      submit: string;
    };
  };
  services: {
    title: string;
    items: { icon: string; title: string; description: string }[];
  };
  bundleSave: {
    title: string;
    savings: string;
    features: { icon: string; title: string; description: string }[];
    cta: string;
  };
  packageBuilder: {
    title: string;
    subtitle: string;
    toggleOpen: string;
    toggleClose: string;
    toggleInProgress: string;
    allSelected: string;
    changeHotel: string;
    viewService: string;
    addService: string;
    removeTag: string;
    checkoutButton: string;
    helper: string;
    warningSelectHotel: string;
    sessionExpiresIn: string;
    sessionWarningTen: string;
    sessionWarningFive: string;
    sessionExpired: string;
    requiredTag: string;
    selectedTag: string;
    addTag: string;
    disabledTag: string;
    serviceDisabled: string;
      transfers: {
        individual: string;
        group: string;
        startingFrom: string;
        selectType: string;
      perCar: string;
      perPax: string;
      minPaxFeeNote: string;
      childPolicyLabel: string;
      childPolicyFree: PluralForms;
      childPolicyHalf: PluralForms;
    };
    excursions: {
      allLabel: string;
      yasLabel: string;
      safariLabel: string;
      cruiseLabel: string;
      helicopterLabel: string;
      countLabel: PluralForms;
      filterNote: string;
      noMatch: string;
    };
    flights: {
      searchButton: string;
      searching: string;
      searchPrompt: string;
      noOptions: string;
      loadFailed: string;
      demoNote: string;
      redirectButton: string;
      externalNote: string;
      unsupportedDestination: string;
      missingHotelDetails: string;
      infantsLabel: string;
      summaryLabel: string;
    };
    services: {
      hotel: string;
      flight: string;
      transfer: string;
      excursion: string;
      insurance: string;
    };
    pages: {
      hotel: { title: string; body: string; note: string; cta: string };
      flight: { title: string; body: string; note: string; cta: string };
      transfer: { title: string; body: string; note: string; cta: string };
      excursion: { title: string; body: string; note: string; cta: string };
      insurance: { title: string; body: string; note: string; cta: string };
    };
    insurance: {
      note: string;
      quoteLabel: string;
      quoteLoading: string;
      ageRateLabel: string;
      selectPlanNote: string;
      coverageLabel: string;
      programTitle: string;
      coverageListTitle: string;
      territoryLabel: string;
      travelCountriesLabel: string;
      travelCountriesPlaceholder: string;
      defaultTravelCountry: string;
      startDateLabel: string;
      endDateLabel: string;
      daysLabel: string;
      roamingLabel: string;
      subrisksTitle: string;
      guestToggleRemove: string;
      guestToggleAdd: string;
      errors: {
        invalidDays: string;
        minimumDays: string;
        ageLimit: string;
      };
      subrisks: {
        amateurSport: {
          label: string;
          rate: string;
          description: string;
        };
        baggage: {
          label: string;
          rate: string;
          description: string;
        };
        travelInconveniences: {
          label: string;
          rate: string;
          description: string;
          limit: string;
        };
        houseInsurance: {
          label: string;
          rate: string;
          description: string;
          limit: string;
        };
        tripCancellation: {
          label: string;
          rate: string;
          description: string;
          limit: string;
        };
      };
      territories: {
        worldwideExcluding: string;
        worldwideExcludingPolicy: string;
      };
      plans: {
        elite: { title: string; description: string; coverages: string[] };
      };
    };
    checkout: {
      title: string;
      subtitle: string;
      summaryTitle: string;
      emptySummary: string;
      pendingDetails: string;
      contactTitle: string;
      contactHint: string;
      firstName: string;
      lastName: string;
      latinHint: string;
      armenianHint: string;
      email: string;
      phone: string;
      guestTitle: string;
      guestHint: string;
      guestEmpty: string;
      guestRoomLabel: string;
      guestAdultLabel: string;
      guestChildLabel: string;
      guestLeadLabel: string;
      ageLabel: string;
    countryPlaceholder: string;
      insuranceTitle: string;
      insuranceHint: string;
      insuranceEmpty: string;
      insuranceTravelerLabel: string;
      copyLeadTravelerContact: string;
      insuranceFields: {
        firstNameEn: string;
        lastNameEn: string;
        gender: string;
        genderPlaceholder: string;
        genderMale: string;
        genderFemale: string;
        birthDate: string;
        passportNumber: string;
        passportAuthority: string;
        passportIssueDate: string;
        passportExpiryDate: string;
        residency: string;
        citizenship: string;
        socialCard: string;
        optionalPlaceholder: string;
        mobilePhone: string;
        phone: string;
        email: string;
        address: string;
        country: string;
        region: string;
        city: string;
      };
      couponTitle: string;
      couponPlaceholder: string;
      applyCoupon: string;
      couponApplied: string;
      couponInvalid: string;
      couponDisabled: string;
      couponNotStarted: string;
      couponExpired: string;
      couponLimitReached: string;
      couponTemporarilyDisabled: string;
      couponRateLimited: string;
      couponUnavailable: string;
      couponDiscountLabel: string;
      couponTotalAfterDiscount: string;
      couponEnterCode: string;
      couponApplying: string;
      insuranceTerms: {
        prefix: string;
        link: string;
        suffix: string;
      };
      devInsuranceSubmit: string;
      devInsuranceSuccess: string;
      paymentTitle: string;
      paymentHint: string;
      paymentMethodsUnavailable: string;
      methodIdram: string;
      methodCard: string;
      methodCardAmeria: string;
      cardName: string;
      cardNumber: string;
      cardExpiry: string;
      cardCvc: string;
      termsLabel: string;
      termsConnector: string;
      payIdram: string;
      payCard: string;
      payCardAmeria: string;
      totalTitle: string;
      totalLabel: string;
      nonRefundableWarning: string;
      restoreDraftTitle: string;
      restoreDraftPrompt: string;
      restoreDraftConfirm: string;
      restoreDraftCancel: string;
      errors: {
        missingHotel: string;
        missingDetails: string;
        missingGuestDetails: string;
        insuranceDetailsRequired: string;
        insuranceArmenianName: string;
        insuranceQuoteFailed: string;
        invalidDateFormat: string;
        birthDateFuture: string;
        passportIssueDateFuture: string;
        passportExpiryBeforeIssueDate: string;
        cardUnavailable: string;
        prebookInvalid: string;
        prebookReturnToHotel: string;
        duplicatePaymentAttempt: string;
        bookingNotConfirmed: string;
        bookingCanceled: string;
        bookingModificationClosed: string;
        addonServiceExists: string;
        serviceDisabled: string;
        paymentFailed: string;
      };
        labels: {
          destination: string;
          dates: string;
          rooms: string;
          guests: string;
          route: string;
          vehicle: string;
          price: string;
          type: string;
          hotelCode: string;
          excursions: string;
        };
      };
  };
  trustStats: {
    title: string;
    stats: { value: string; label: string; icon: string }[];
  };
  exclusives: {
    offers: { title: string; badge: string; description: string; cta: string; soon: string }[];
  };
  featured: { title: string; subtitle: string; cta: string };
  faq: {
    title: string;
    items: { title: string; body: string }[];
  };
  card: { from: string; perNight: string; reviews: string; cta: string };
  auth: {
    checking: string;
    signedIn: string;
    signOut: string;
    signIn: string;
    guestInitialsFallback: string;
    guestNameFallback: string;
  };
  accessibility: {
    skipToContent: string;
    servicesSection: string;
    bundleSection: string;
  };
  header: {
    openMenu: string;
    closeMenu: string;
    primaryNav: string;
  };
  footer: {
    refundPolicy: string;
    securityPolicy: string;
    b2bPartnership: string;
    followUs: string;
    poweredBy: string;
    copyright: string;
  };
  home: {
    idram: {
      title: string;
      body: string;
      alt: string;
    };
    efes: {
      title: string;
      body: string;
      alt: string;
    };
    esim: {
      title: string;
      body: string;
      alt: string;
    };
    flydubai: {
      title: string;
      body: string;
      alt: string;
    };
    yas: {
      title: string;
      body: string;
      alt: string;
    };
  };
  payment: {
    success: {
      title: string;
      body: string;
      note: string;
      insuranceWarning: string;
      cta: string;
      addons: {
        title: string;
        body: string;
        pendingTitle: string;
        pendingBody: string;
      };
    };
    failure: {
      title: string;
      body: string;
      cta: string;
    };
    errors: {
      invalidBill: string;
      unauthorized: string;
      signInRequired: string;
    };
  };
  profile: {
    title: string;
    subtitle: string;
    memberSince: string;
    signIn: {
      title: string;
      body: string;
      cta: string;
    };
    stats: {
      bookings: string;
      searches: string;
      favorites: string;
      nights: string;
      lastActivity: string;
    };
    bookings: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      status: {
        confirmed: string;
        pending: string;
        failed: string;
        unknown: string;
      };
      labels: {
        bookingId: string;
        confirmation: string;
        hotelName: string;
        destination: string;
        rooms: string;
        guests: string;
        total: string;
        bookedOn: string;
        duration: string;
      };
      viewHotel: string;
      viewVoucher: string;
      downloadVoucher: string;
    };
    voucher: {
      title: string;
      subtitle: string;
      downloadPdf: string;
      backToProfile: string;
      issuedOn: string;
      paymentNote: string;
      insuranceWarning: string;
      modificationClosed: string;
      addons: {
        available: string;
        unavailable: string;
        helper: string;
        unavailableHelper: string;
      };
      addServices: {
        title: string;
        subtitle: string;
        bookingSummaryTitle: string;
        serviceSelectionTitle: string;
        includedTitle: string;
        unavailableTitle: string;
        selectionHint: string;
        emptySelection: string;
        noRemainingTitle: string;
        noRemainingBody: string;
        noAvailableTitle: string;
        noAvailableBody: string;
        openService: string;
        updateSelection: string;
        totalDue: string;
        lastPaymentTitle: string;
        lastPaymentRequested: string;
        lastPaymentApplied: string;
        lastPaymentFailed: string;
        lastPaymentSkipped: string;
        insuranceFailedStatus: string;
        insuranceFailedBody: string;
        insuranceRetryHint: string;
        insuranceRetryConfirm: string;
        insuranceRetry: string;
        insuranceRetrying: string;
        insuranceRetryFailed: string;
        insuranceRetryAlreadyIssued: string;
        adminPaymentMethod: string;
        adminPaymentSubmit: string;
        continueToTravelerDetails: string;
        continueToTravelerDetailsHint: string;
      };
      sections: {
        stay: string;
        payment: string;
        updates: string;
        services: string;
        guests: string;
        notes: string;
      };
      updates: {
        bookingStatus: string;
        canceled: string;
        canceledOn: string;
        refundStatus: string;
        refundedAmount: string;
        refundedServices: string;
        refundStates: {
          refunded: string;
          already_refunded: string;
          in_progress: string;
          failed: string;
          unknown: string;
        };
        serviceCanceled: string;
        serviceCancelPending: string;
        serviceCancelFailed: string;
      };
      notes: string;
    };
    searches: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      labels: {
        dates: string;
        results: string;
        rooms: string;
        guests: string;
        destination: string;
        hotel: string;
        searchedOn: string;
      };
      searchAgain: string;
    };
    favorites: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      viewHotel: string;
      locationFallback: string;
      labels: {
        rating: string;
        savedOn: string;
        name: string;
      };
    };
    insights: {
      title: string;
      subtitle: string;
      labels: {
        topDestination: string;
        averageStay: string;
        roomsBooked: string;
        lastBooking: string;
      };
      empty: string;
    };
    actions: {
      title: string;
      browse: string;
      items: {
        newSearch: { title: string; body: string; cta: string };
        savedTravelers: { title: string; body: string; cta: string };
        priceAlerts: { title: string; body: string; cta: string };
      };
    };
    errors: {
      title: string;
      body: string;
    };
  };
  admin: {
    title: string;
    subtitle: string;
    dashboard: {
      title: string;
      subtitle: string;
      navTitle: string;
      navSubtitle: string;
      open: string;
      cards: {
        bookings: string;
        b2bBookings: string;
        featured: string;
        users: string;
        searches: string;
        favorites: string;
        services: string;
        promoPopup: string;
      };
    };
    services: {
      title: string;
      subtitle: string;
      panelTitle: string;
      note: string;
      aiChatLabel: string;
      saved: string;
      actions: {
        save: string;
        saving: string;
      };
      status: {
        enabled: string;
        disabled: string;
      };
      errors: {
        saveFailed: string;
      };
    };
    featured: {
      title: string;
      subtitle: string;
      searchTitle: string;
      searchSubtitle: string;
      searchLabel: string;
      searchPlaceholder: string;
      loading: string;
      noResults: string;
      alreadySelected: string;
      formTitle: string;
      formSubtitle: string;
      emptyTitle: string;
      emptyBody: string;
      fields: {
        priceFrom: string;
        oldPrice: string;
        badge: string;
        availability: string;
        amenities: string;
        selected: string;
      };
      previewLabel: string;
      listTitle: string;
      listSubtitle: string;
      listEmptyTitle: string;
      listEmptyBody: string;
      actions: {
        save: string;
        saving: string;
        edit: string;
        remove: string;
        removing: string;
        clear: string;
      };
      validation: {
        selectHotel: string;
        priceFrom: string;
        oldPrice: string;
        amenities: string;
        amenitiesLimit: string;
        translations: string;
      };
      errors: {
        saveFailed: string;
        removeFailed: string;
      };
    };
    promoPopup: {
      title: string;
      subtitle: string;
      panelTitle: string;
      note: string;
      saved: string;
      actions: {
        save: string;
        saving: string;
      };
      status: {
        enabled: string;
        disabled: string;
      };
      fields: {
        enabled: string;
        campaignKey: string;
        imageUrl: string;
        imageAlt: string;
        eventTicketUrl: string;
        locationSearchUrl: string;
        delayMs: string;
      };
      errors: {
        saveFailed: string;
      };
    };
    users: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      stats: {
        total: string;
      };
      columns: {
        user: string;
        email: string;
        lastLogin: string;
        lastSearch: string;
        lastBooking: string;
        createdAt: string;
      };
    };
    searches: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      columns: {
        user: string;
        destination: string;
        hotel: string;
        dates: string;
        rooms: string;
        guests: string;
        createdAt: string;
      };
    };
    favorites: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      columns: {
        user: string;
        hotel: string;
        location: string;
        rating: string;
        savedAt: string;
      };
    };
    bookings: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
    };
    b2bBookings: {
      title: string;
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      stats: {
        total: string;
        partners: string;
        open: string;
        resolved: string;
        serviceFailed: string;
      };
      filters: {
        searchPlaceholder: string;
        partnerLabel: string;
        reviewLabel: string;
        serviceLabel: string;
        sortLabel: string;
        reset: string;
        all: string;
        reviewOptions: {
          new: string;
          inProgress: string;
          needsFollowup: string;
          resolved: string;
        };
        serviceOptions: {
          anyFailed: string;
          transferFailed: string;
          excursionsFailed: string;
          insuranceFailed: string;
        };
        sortOptions: {
          newest: string;
          oldest: string;
        };
      };
      columns: {
        requestId: string;
        partner: string;
        bookingRef: string;
        hotel: string;
        services: string;
        review: string;
        createdAt: string;
        actions: string;
      };
      labels: {
        transfer: string;
        excursions: string;
        insurance: string;
        bookingRef: string;
        dates: string;
        updatedBy: string;
        updatedAt: string;
        servicePayload: string;
        serviceResult: string;
        bookingResult: string;
        reviewStatus: string;
        note: string;
      };
      serviceStatus: {
        pending: string;
        booked: string;
        failed: string;
        skipped: string;
      };
      actions: {
        save: string;
        saving: string;
        saveSuccess: string;
        saveFailed: string;
      };
    };
    filters: {
      searchPlaceholder: string;
      statusLabel: string;
      sourceLabel: string;
      sortLabel: string;
      reset: string;
      all: string;
      sortOptions: {
        newest: string;
        oldest: string;
        totalHigh: string;
        totalLow: string;
      };
    };
    columns: {
      bookingId: string;
      hotel: string;
      user: string;
      dates: string;
      guests: string;
      total: string;
      net: string;
      profit: string;
      status: string;
      createdAt: string;
      source: string;
      actions: string;
    };
    stats: {
      totalBookings: string;
      totalGuests: string;
      confirmed: string;
      pending: string;
      failed: string;
      unknown: string;
    };
    access: {
      signInTitle: string;
      signInBody: string;
      signInCta: string;
      deniedTitle: string;
      deniedBody: string;
      configTitle: string;
      configBody: string;
    };
    actions: {
      details: string;
      cancel: string;
      cancelLoading: string;
      cancelSuccess: string;
      cancelFailed: string;
      confirmCancel: string;
      refund: string;
      refundLoading: string;
      refundSuccess: string;
      refundFailed: string;
      confirmRefund: string;
      refundAmountLabel: string;
      refundAmountPlaceholder: string;
      refundAmountHint: string;
      refundAmountInvalid: string;
      refundServicesLabel: string;
      partialRefundRequiresServices: string;
      cancelAndRefund: string;
      cancelAndRefundLoading: string;
      cancelAndRefundSuccess: string;
      cancelAndRefundFailed: string;
      confirmCancelAndRefund: string;
    };
    details: {
      payload: string;
      booking: string;
    };
  };
  policies: {
    refund: {
      title: string;
      intro: string;
      sections: PolicySection[];
      note: string;
    };
    security: {
      title: string;
      intro: string;
      sections: PolicySection[];
      note: string;
    };
  };
  results: {
    filters: {
      button: string;
      openLabel: string;
      closeLabel: string;
      title: string;
      priceRange: string;
      rating: string;
      meals: string;
      noPricing: string;
    };
    loading: string;
    errorAlt: string;
    retry: string;
    emptyAlt: string;
    emptyMessage: string;
    fallbackTitle: string;
    placesFound: PluralForms;
    sortLabel: string;
    sortOptions: {
      priceAsc: string;
      priceDesc: string;
      ratingDesc: string;
      ratingAsc: string;
    };
    hotel: {
      fallbackName: string;
      unnamed: string;
      locationFallback: string;
      startingFrom: string;
      forRooms: string;
    };
    viewOptions: string;
    errors: {
      missingSearchDetails: string;
      loadFailed: string;
    };
  };
  promoPopup: {
    ariaLabel: string;
    closeLabel: string;
    eventTicketCta: string;
    locationSearchCta: string;
  };
  common: {
    loading: string;
    backToSearch: string;
    scrollTop: string;
    contact: string;
    contactForRates: string;
    close: string;
    yes: string;
    no: string;
    total: string;
    status: string;
    night: PluralForms;
  };
  hotel: {
    favorites: {
      save: string;
      saved: string;
      saving: string;
      signIn: string;
    };
    addons: {
      title: string;
      subtitle: string;
      badge: string;
      actions: {
        add: string;
        remove: string;
      };
      status: {
        optional: string;
        requested: string;
      };
      summary: {
        rooms: string;
        transfers: string;
        excursions: string;
        insurance: string;
        flights: string;
        requested: string;
      };
      transfers: {
        title: string;
        description: string;
        panelTitle: string;
        airportLabel: string;
        paxLabel: string;
        bagsLabel: string;
        includeReturn: string;
        returnTotal: string;
        oneWayTotal: string;
        perPax: string;
        perVehicle: string;
        bothWays: string;
        flightNumber: string;
        arrivalDate: string;
        departureFlightNumber: string;
        departureDate: string;
        vehicleQty: string;
        loading: string;
        noOptions: string;
        missingDestination: string;
        loadFailed: string;
        selectRequired: string;
        detailsRequired: string;
        flightNumberRequired: string;
        arrivalRequired: string;
        arrivalNotBeforeCheckIn: string;
        departureFlightNumberRequired: string;
        departureRequired: string;
        departureNotBeforeCheckIn: string;
        departureNotBeforeArrival: string;
      };
      excursions: {
        title: string;
        description: string;
        panelTitle: string;
        adultsLabel: string;
        childrenLabel: string;
        feeNote: string;
        loading: string;
        noOptions: string;
        loadFailed: string;
        unnamed: string;
        adultPrice: string;
        childPrice: string;
        totalLabel: string;
        applyAll: string;
      };
      insurance: {
        title: string;
        description: string;
        panelTitle: string;
        noteLabel: string;
        notePlaceholder: string;
        plans: {
          elite: { title: string; description: string };
        };
      };
      flights: {
        title: string;
        description: string;
        panelTitle: string;
        originLabel: string;
        destinationLabel: string;
        departureLabel: string;
        returnLabel: string;
        cabinLabel: string;
        cabinPlaceholder: string;
        notesLabel: string;
        notesPlaceholder: string;
        cabin: {
          economy: string;
          premium: string;
          business: string;
          first: string;
        };
      };
    };
    map: {
      viewAria: string;
      showButton: string;
      title: string;
      iframeTitle: string;
      ariaLabel: string;
      closeLabel: string;
    };
    amenities: {
      title: string;
      showLess: string;
      showAll: string;
    };
    searchTitle: string;
    roomOptions: {
      loading: string;
      empty: string;
      noMatch: string;
      loadErrorTitle: string;
      promotionLabel: string;
      discountLabel: string;
      count: PluralForms;
      of: string;
      filterMeal: string;
      filterPrice: string;
      allMeals: string;
      recommended: string;
      lowestPrice: string;
      highestPrice: string;
      roomOptionFallback: string;
      roomBundleTitle: string;
      forRooms: string;
      mealPlans: {
        roomOnly: string;
        breakfast: string;
        halfBoard: string;
        fullBoard: string;
        allInclusive: string;
        ultraAllInclusive: string;
      };
      refundable: string;
      nonRefundable: string;
      roomsLeft: PluralForms;
      roomBreakdown: string;
      signInToBook: string;
      checkingAvailability: string;
      bookNow: string;
    };
    booking: {
      titleFallback: string;
      successMessage: string;
      confirmationNumberLabel: string;
      priceChangeWarning: string;
      priceChangeConfirm: string;
      resetPackageWarning: string;
      resetPackageConfirm: string;
      nonRefundableWarning: string;
      titles: { mr: string; ms: string; mrs: string; master: string };
      firstNamePlaceholder: string;
      lastNamePlaceholder: string;
      mealPlanLabel: string;
      rateTypeLabel: string;
      bedTypeSingle: string;
      bedTypePlural: string;
      inclusionsLabel: string;
      cancellationPolicyTitle: string;
      noPenaltyDetails: string;
      remarksTitle: string;
      additionalInfo: string;
      roomPriceLabel: string;
      roomLabel: string;
      paymentNote: string;
      redirectingToIdram: string;
      payWithIdram: string;
      selectRoom: string;
      closeBookingAria: string;
    };
    policy: {
      freeCancellation: string;
      from: string;
      until: string;
    };
    remarks: {
      types: {
        mandatory: string;
        mandatoryTax: string;
        mandatoryFee: string;
        mandatoryCharge: string;
        optional: string;
        knowBeforeYouGo: string;
        disclaimer: string;
        note: string;
      };
      defaultLabel: string;
    };
    policies: {
      types: {
        cancellation: string;
        noShow: string;
        modification: string;
      };
      defaultLabel: string;
    };
    errors: {
      roomNeedsAdult: string;
      missingGuestNames: string;
      invalidGuestAges: string;
      invalidChildAge: string;
      invalidAdultAge: string;
      checkingSignIn: string;
      signInToBook: string;
      missingSession: string;
      cannotBookOption: string;
      missingRateKeys: string;
      unableBuildGuests: string;
      prebookFailed: string;
      signInToComplete: string;
      confirmPriceChange: string;
      missingSessionPrebook: string;
      missingDestination: string;
      roomMissingRateKey: string;
      roomMissingPrice: string;
      redirectPayment: string;
      startPaymentFailed: string;
      duplicatePaymentAttempt: string;
      loadHotelFailed: string;
      loadRoomOptionsFailed: string;
    };
  };
  gallery: {
    label: string;
    imageAlt: string;
    closeLabel: string;
    prevLabel: string;
    nextLabel: string;
  };
};
