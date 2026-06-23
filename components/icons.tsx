/** Minimal stroke icons, 16x16 viewBox, inherit currentColor. */
interface IconProps {
    className?: string;
    style?: React.CSSProperties;
}
function Svg({
                 children,
                 className,
                 style,
             }: IconProps & { children: React.ReactNode }) {
    return (
        <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className ?? "h-4 w-4"}
            style={style}
            aria-hidden
        >
            {children}
        </svg>
    );
}

export const IconPlus = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 3.33V12.67M3.33 8H12.67" />
    </Svg>
);
export const IconMenu = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </Svg>
);
export const IconChat = (p: IconProps) => (
    <Svg {...p}>
        <path d="M14 10C14 10.35 13.86 10.69 13.61 10.94C13.36 11.19 13.02 11.33 12.67 11.33H4.67L2 14V3.33C2 2.98 2.14 2.64 2.39 2.39C2.64 2.14 2.98 2 3.33 2H12.67C13.02 2 13.36 2.14 13.61 2.39C13.86 2.64 14 2.98 14 3.33V10Z" />
    </Svg>
);
export const IconBox = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11V5Z" />
        <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
    </Svg>
);
export const IconImage = (p: IconProps) => (
    <Svg {...p}>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <circle cx="5.75" cy="6.25" r="1.1" />
        <path d="M2.5 11.5 6 8l2 2 2.5-2.5L13.5 10" />
    </Svg>
);
export const IconSearch = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="6.87" cy="6.87" r="5" />
        <path d="M14 14L10.4 10.4" />
    </Svg>
);
export const IconCode = (p: IconProps) => (
    <Svg {...p}>
        <path d="m4.5 5.5-2.5 2.5 2.5 2.5M11.5 5.5l2.5 2.5-2.5 2.5M9.5 3l-3 10" />
    </Svg>
);
export const IconClose = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 4L12 12M12 4L4 12" />
    </Svg>
);
export const IconSend = (p: IconProps) => (
    <Svg {...p}>
        <path d="M14.67 1.33L7.33 8.67M14.67 1.33L10 14.67L7.33 8.67M14.67 1.33L1.33 6L7.33 8.67" />
    </Svg>
);
export const IconStop = (p: IconProps) => (
    <Svg {...p}>
        <rect x="4" y="4" width="8" height="8" rx="1" />
    </Svg>
);
export const IconTrash = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2 4H14M5.33 4V2.67C5.33 2.3 5.63 2 6 2H10C10.37 2 10.67 2.3 10.67 2.67V4M6.67 7V11.33M9.33 7V11.33M3.33 4L4 13.33C4 13.7 4.3 14 4.67 14H11.33C11.7 14 12 13.7 12 13.33L12.67 4" />
    </Svg>
);
export const IconCopy = (p: IconProps) => (
    <Svg {...p}>
        <rect x="5.33" y="5.33" width="8.67" height="8.67" rx="1.33" />
        <path d="M3.33 10.67V3.33C3.33 2.6 3.93 2 4.67 2H10.67" />
    </Svg>
);
export const IconCheck = (p: IconProps) => (
    <Svg {...p}>
        <path d="M3.33 8.67L6.33 11.67L12.67 4.33" />
    </Svg>
);
export const IconChevron = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 6L8 10L12 6" />
    </Svg>
);
export const IconSpark = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 2.5L8 5.5M12.3 4.57L9.95 6.44M13.36 9.22L10.44 8.56M10.39 12.96L9.08 10.25M5.61 12.96L6.92 10.25M2.64 9.22L5.56 8.56M3.7 4.57L6.05 6.44" />
    </Svg>
);
export const IconMail = (p: IconProps) => (
    <Svg {...p}>
        <rect x="1.33" y="2.67" width="13.33" height="10.67" rx="1.33" />
        <path d="M1.33 4.67L8 8.67L14.67 4.67" />
    </Svg>
);
export const IconUser = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="8" cy="5.33" r="2.67" />
        <path d="M2.67 13.33C2.67 11.33 4.67 9.33 8 9.33C11.33 9.33 13.33 11.33 13.33 13.33" />
    </Svg>
);
export const IconShield = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 1.33L2 4.67V8C2 11.5 4.5 14.5 8 15.33C11.5 14.5 14 11.5 14 8V4.67L8 1.33Z" />
        <path d="M6 8L7.33 9.33L10 6.67" />
    </Svg>
);
export const IconShieldPlain = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 1.33L2 4.67V8C2 11.5 4.5 14.5 8 15.33C11.5 14.5 14 11.5 14 8V4.67L8 1.33Z" />
    </Svg>
);
export const IconClock = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="8" cy="8" r="6.67" />
        <path d="M8 4V8L10.67 9.33" />
    </Svg>
);
export const IconList = (p: IconProps) => (
    <Svg {...p}>
        <path d="M5.33 4H14M5.33 8H14M5.33 12H14M2 4H2.01M2 8H2.01M2 12H2.01" />
    </Svg>
);
export const IconLink = (p: IconProps) => (
    <Svg {...p}>
        <path d="M6.67 8.67a3.33 3.33 0 0 0 5.03 0.36l2-2a3.33 3.33 0 0 0-4.71-4.71l-1.15 1.14" />
        <path d="M9.33 7.33a3.33 3.33 0 0 0-5.03-0.36l-2 2a3.33 3.33 0 0 0 4.71 4.71l1.14-1.14" />
    </Svg>
);
export const IconHome = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2 8L8 2L14 8" />
        <path d="M3.33 6.67V12.67C3.33 13.4 3.93 14 4.67 14H11.33C12.07 14 12.67 13.4 12.67 12.67V6.67" />
        <rect x="6.17" y="9.33" width="3.67" height="4.67" rx="0.67" />
    </Svg>
);
export const IconGrip = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="6" cy="4" r="1" fill="currentColor" stroke="none" />
        <circle cx="10" cy="4" r="1" fill="currentColor" stroke="none" />
        <circle cx="6" cy="8" r="1" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" />
        <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />
    </Svg>
);
export const IconRefresh = (p: IconProps) => (
    <Svg {...p}>
        <path d="M11.77 4.23A5.33 5.33 0 1 0 13.33 8.67" />
        <path d="M12.87 2V5.4H9.33" />
    </Svg>
);
export const IconPin = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 1.33C5.42 1.33 3.33 3.42 3.33 6C3.33 9.5 8 14.67 8 14.67C8 14.67 12.67 9.5 12.67 6C12.67 3.42 10.58 1.33 8 1.33Z" />
        <circle cx="8" cy="6" r="1.67" />
    </Svg>
);
export const IconBriefcase = (p: IconProps) => (
    <Svg {...p}>
        <rect x="1.33" y="4.67" width="13.33" height="9.33" rx="1.33" />
        <path d="M10.67 4.67V3.33C10.67 2.6 10.07 2 9.33 2H6.67C5.93 2 5.33 2.6 5.33 3.33V4.67" />
    </Svg>
);
export const IconWrench = (p: IconProps) => (
    <Svg {...p}>
        <path d="M9.8 4.2a0.67 0.67 0 0 0 0 0.93l1.07 1.07a0.67 0.67 0 0 0 0.93 0l2.51-2.51a4 4 0 0 1-5.29 5.29L4.49 13.43a1.42 1.42 0 0 1-2-2l4.45-4.45a4 4 0 0 1 5.29-5.29L9.8 4.2z" />
    </Svg>
);
export const IconGear = (p: IconProps) => (
    <Svg {...p}>
        <path d="M7.07 1.77L8.93 1.77L9.22 3.46L10.35 3.93L11.75 2.94L13.06 4.25L12.07 5.65L12.54 6.78L14.23 7.07L14.23 8.93L12.54 9.22L12.07 10.35L13.06 11.75L11.75 13.06L10.35 12.07L9.22 12.54L8.93 14.23L7.07 14.23L6.78 12.54L5.65 12.07L4.25 13.06L2.94 11.75L3.93 10.35L3.46 9.22L1.77 8.93L1.77 7.07L3.46 6.78L3.93 5.65L2.94 4.25L4.25 2.94L5.65 3.93L6.78 3.46Z" />
        <circle cx="8" cy="8" r="2.1" />
    </Svg>
);
export const IconGlobe = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="8" cy="8" r="6.33" />
        <path d="M1.67 8H14.33M8 1.67C9.67 3.5 10.5 5.7 10.5 8C10.5 10.3 9.67 12.5 8 14.33C6.33 12.5 5.5 10.3 5.5 8C5.5 5.7 6.33 3.5 8 1.67Z" />
    </Svg>
);
export const IconDoc = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 1.67h5L12.67 5.33V13.33C12.67 13.7 12.37 14 12 14H4C3.63 14 3.33 13.7 3.33 13.33V2.33C3.33 1.97 3.63 1.67 4 1.67Z" />
        <path d="M8.67 1.67V5.33H12.67M5.33 8.33H10.67M5.33 10.67H10.67" />
    </Svg>
);
export const IconPencil = (p: IconProps) => (
    <Svg {...p}>
        <path d="M11.33 2L14 4.67L5.33 13.33L2 14L2.67 10.67L11.33 2Z" />
        <path d="M10 3.33L12.67 6" />
    </Svg>
);
export const IconFolder = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2 4.33C2 3.6 2.6 3 3.33 3H6L7.33 4.67H12.67C13.4 4.67 14 5.27 14 6V11.67C14 12.4 13.4 13 12.67 13H3.33C2.6 13 2 12.4 2 11.67V4.33Z" />
    </Svg>
);
export const IconFolderOpen = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2 5.33C2 4.6 2.6 4 3.33 4H6L7.33 5.67H12C12.73 5.67 13.33 6.27 13.33 7H4.67C4.07 7 3.55 7.4 3.4 7.97L2 13V5.33Z" />
        <path d="M3.4 7.97C3.55 7.4 4.07 7 4.67 7H14L12.6 12.03C12.45 12.6 11.93 13 11.33 13H2L3.4 7.97Z" />
    </Svg>
);
export const IconFile = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 1.67h5L12.67 5.33V13.33C12.67 13.7 12.37 14 12 14H4C3.63 14 3.33 13.7 3.33 13.33V2.33C3.33 1.97 3.63 1.67 4 1.67Z" />
        <path d="M8.67 1.67V5.33H12.67" />
    </Svg>
);
export const IconTerminal = (p: IconProps) => (
    <Svg {...p}>
        <rect x="1.67" y="2.67" width="12.67" height="10.67" rx="1.33" />
        <path d="M4.33 6L6.33 8L4.33 10M8 10H11.33" />
    </Svg>
);
export const IconPlay = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 2.67L13 8L4 13.33V2.67Z" fill="currentColor" stroke="none" />
    </Svg>
);
export const IconDownload = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 2V10.67M8 10.67L4.67 7.33M8 10.67L11.33 7.33M2.67 13.33H13.33" />
    </Svg>
);
export const IconSliders = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2.67 4.67H10M12.67 4.67H13.33M2.67 11.33H6M8.67 11.33H13.33" />
        <circle cx="11" cy="4.67" r="1.33" />
        <circle cx="7" cy="11.33" r="1.33" />
    </Svg>
);export const IconTag = (p: IconProps) => (
    <Svg {...p}>
        <path d="M2.67 2.67H7.33L13.33 8.67L8.67 13.33L2.67 7.33V2.67Z" />
        <circle cx="5.33" cy="5.33" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
);
export const IconUpload = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 10.67V2M8 2L4.67 5.33M8 2L11.33 5.33M2.67 13.33H13.33" />
    </Svg>
);
export const IconPaperclip = (p: IconProps) => (
    <Svg {...p}>
        <path d="M13 7.33L7.83 12.5C6.55 13.78 4.45 13.78 3.17 12.5C1.89 11.22 1.89 9.12 3.17 7.83L8.5 2.5C9.35 1.65 10.75 1.65 11.6 2.5C12.45 3.35 12.45 4.75 11.6 5.6L6.4 10.8C5.97 11.23 5.27 11.23 4.85 10.8C4.42 10.38 4.42 9.68 4.85 9.25L9.67 4.43" />
    </Svg>
);
export const IconX = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 4L12 12M12 4L4 12" />
    </Svg>
);
export const IconCoin = (p: IconProps) => (
    <Svg {...p}>
        <circle cx="8" cy="8" r="5.33" />
        <path d="M8 5.33V10.67M9.67 6.5C9.67 5.7 8.9 5.33 8 5.33C7.1 5.33 6.33 5.7 6.33 6.5C6.33 8.3 9.67 7.5 9.67 9.5C9.67 10.3 8.9 10.67 8 10.67C7.1 10.67 6.33 10.3 6.33 9.5" />
    </Svg>
);
export const IconResize = (p: IconProps) => (
    <Svg {...p}>
        <path d="M9.33 2.67H13.33V6.67M13.33 2.67L9 7M6.67 13.33H2.67V9.33M2.67 13.33L7 9" />
    </Svg>
);
export const IconLayers = (p: IconProps) => (
    <Svg {...p}>
        <path d="M8 1.67 1.67 5 8 8.33 14.33 5 8 1.67Z" />
        <path d="M1.67 11 8 14.33 14.33 11M1.67 8 8 11.33 14.33 8" />
    </Svg>
);
export const IconRevert = (p: IconProps) => (
    <Svg {...p}>
        <path d="M3.5 8a4.5 4.5 0 1 1 1.4 3.26" />
        <path d="M3.13 4.67V8H6.47" />
    </Svg>
);
export const IconSquare = (p: IconProps) => (
    <Svg {...p}>
        <rect x="2.67" y="2.67" width="10.67" height="10.67" rx="2" />
    </Svg>
);
export const IconCheckSquare = (p: IconProps) => (
    <Svg {...p}>
        <path d="M5.67 8 7.33 9.67 10.67 6.33" />
        <rect x="2.67" y="2.67" width="10.67" height="10.67" rx="2" />
    </Svg>
);
export const IconSort = (p: IconProps) => (
    <Svg {...p}>
        <path d="M4 3.33V12.67M4 12.67 2 10.67M4 12.67 6 10.67M10.67 4.67H14M10.67 8H13.33M10.67 11.33H12" />
    </Svg>
);
